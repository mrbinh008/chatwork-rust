use serde::{Deserialize, Serialize};
use std::{fs::{self, File, OpenOptions}, io::{self, Read, Write}, net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream}, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};

#[derive(Serialize, Deserialize)]
struct Endpoint { port: u16, token: String }
pub enum Launch { Primary(Instance), Secondary }
pub struct Instance {
    _lock: File,
    listener: Option<TcpListener>,
    metadata: PathBuf,
    token: String,
    running: Arc<AtomicBool>,
}
impl Instance {
    pub fn acquire(directory: &Path) -> io::Result<Launch> {
        fs::create_dir_all(directory)?;
        let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(directory.join("instance.lock"))?;
        let metadata = directory.join("instance.json");
        if !try_lock(&file)? {
            // A primary process may still be writing its activation endpoint.
            let deadline=std::time::Instant::now()+Duration::from_secs(5);
            while std::time::Instant::now()<deadline {
                if notify(&metadata).is_ok() { break; }
                std::thread::sleep(Duration::from_millis(100));
            }
            return Ok(Launch::Secondary);
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let token = format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
        let endpoint = Endpoint { port: listener.local_addr()?.port(), token: token.clone() };
        let temp = directory.join(format!("instance-{}.tmp", std::process::id()));
        fs::write(&temp, serde_json::to_vec(&endpoint)?)?;
        fs::rename(temp, &metadata)?;
        Ok(Launch::Primary(Self { _lock:file, listener:Some(listener), metadata, token, running:Arc::new(AtomicBool::new(true)) }))
    }
    pub fn listen(&mut self, focus: impl Fn() + Send + 'static) {
        let Some(listener) = self.listener.take() else { return; };
        let token = self.token.clone(); let running = self.running.clone();
        std::thread::spawn(move || {
            while running.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, peer)) => {
                        if !peer.ip().is_loopback() { continue; }
                        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                        let mut buffer=[0u8;256];
                        let expected=format!("THK-Chat:{token}\n");
                        if stream.read_exact(&mut buffer[..expected.len()]).is_ok() && &buffer[..expected.len()] == expected.as_bytes() {
                            focus(); let _ = stream.write_all(b"OK");
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
        });
    }
}
impl Drop for Instance {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        let _ = fs::remove_file(&self.metadata);
        // Closing the file releases the OS lock, including after a crash.
    }
}
fn notify(path: &Path) -> io::Result<()> {
    let bytes=fs::read(path)?;
    let endpoint:Endpoint=serde_json::from_slice(&bytes)?;
    if endpoint.token.len()>200 { return Err(io::Error::other("Invalid activation endpoint")); }
    let mut stream=TcpStream::connect_timeout(&SocketAddrV4::new(Ipv4Addr::LOCALHOST,endpoint.port).into(),Duration::from_millis(300))?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    stream.write_all(format!("THK-Chat:{}\n",endpoint.token).as_bytes())?;
    let mut response=[0u8;2];stream.read_exact(&mut response)?;
    if &response!=b"OK" { return Err(io::Error::other("Invalid activation response")); }
    Ok(())
}
#[cfg(windows)]
fn try_lock(file:&File)->io::Result<bool> {
    use std::{ffi::c_void,os::windows::io::AsRawHandle};
    #[repr(C)] struct Overlapped { internal:usize, internal_high:usize, offset:u32, offset_high:u32, event:*mut c_void }
    #[link(name="kernel32")]
    extern "system" { fn LockFileEx(file:*mut c_void,flags:u32,reserved:u32,low:u32,high:u32,overlapped:*mut Overlapped)->i32; }
    let mut overlapped=Overlapped { internal:0,internal_high:0,offset:0,offset_high:0,event:std::ptr::null_mut() };
    if unsafe { LockFileEx(file.as_raw_handle(),3,0,1,0,&mut overlapped) } != 0 { return Ok(true); }
    let error=io::Error::last_os_error();
    if error.raw_os_error()==Some(33) { Ok(false) } else { Err(error) }
}
#[cfg(unix)]
fn try_lock(file:&File)->io::Result<bool> {
    use std::os::fd::AsRawFd;
    extern "C" { fn flock(fd:i32,operation:i32)->i32; }
    if unsafe { flock(file.as_raw_fd(),2|4) }==0 { return Ok(true); }
    let error=io::Error::last_os_error();
    if error.kind()==io::ErrorKind::WouldBlock { Ok(false) } else { Err(error) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn second_launch_activates_primary_and_lock_recovers_after_exit() {
        let root=std::env::current_dir().unwrap().join("target").join(format!("instance-test-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let Launch::Primary(mut first)=Instance::acquire(&root).unwrap() else { panic!("First launch must own lock") };
        let (sender,receiver)=std::sync::mpsc::channel();first.listen(move||{let _=sender.send(());});
        assert!(matches!(Instance::acquire(&root).unwrap(),Launch::Secondary));
        receiver.recv_timeout(Duration::from_secs(2)).expect("The existing window must receive activation");
        let child=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","single_instance::tests::secondary_process_probe"])
            .env("THK_INSTANCE_TEST_DIRECTORY",&root).output().unwrap();
        assert!(child.status.success(),"Second process must exit without creating another instance: {}",String::from_utf8_lossy(&child.stderr));
        receiver.recv_timeout(Duration::from_secs(2)).expect("Second process must focus the existing window");
        drop(first);
        // A stale endpoint from a crashed app must never prevent the next launch.
        fs::write(root.join("instance.json"),br#"{"port":1,"token":"stale"}"#).unwrap();
        assert!(matches!(Instance::acquire(&root).unwrap(),Launch::Primary(_)));
        fs::remove_file(root.join("instance.lock")).unwrap();fs::remove_dir(root).unwrap();
    }
    #[test] fn secondary_process_probe() {
        if let Some(directory)=std::env::var_os("THK_INSTANCE_TEST_DIRECTORY") {
            assert!(matches!(Instance::acquire(Path::new(&directory)).unwrap(),Launch::Secondary));
        }
    }
}
