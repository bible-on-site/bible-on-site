use std::io::{self, Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn clear_only_uses_the_local_s3_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();

    // Exercise the actual CLI and AWS client without requiring an external service.
    let server = thread::spawn(move || -> io::Result<Vec<String>> {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut requests = Vec::new();
        while requests.len() < 2 {
            let (mut stream, _) = match listener.accept() {
                Ok(connection) => connection,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "missing S3 request",
                        ));
                    }
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(error) => return Err(error),
            };
            stream.set_nonblocking(false)?;
            stream.set_read_timeout(Some(Duration::from_secs(3)))?;
            stream.set_write_timeout(Some(Duration::from_secs(3)))?;
            let mut headers = Vec::new();
            let mut buffer = [0; 1024];
            while !headers.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = stream.read(&mut buffer)?;
                if count == 0 || headers.len() + count > 16 * 1024 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid HTTP headers",
                    ));
                }
                headers.extend_from_slice(&buffer[..count]);
            }
            let headers = String::from_utf8_lossy(&headers);
            let request = headers.lines().next().unwrap().to_owned();
            let body = if request.starts_with("HEAD ") {
                ""
            } else {
                "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>fixture</Name><IsTruncated>false</IsTruncated></ListBucketResult>"
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )?;
            requests.push(request);
        }
        Ok(requests)
    });

    let output = Command::new(env!("CARGO_BIN_EXE_s3-populator"))
        .args([
            "--endpoint",
            &endpoint,
            "--bucket",
            "fixture",
            "--region",
            "us-east-1",
            "--access-key-id",
            "test",
            "--secret-access-key",
            "test_1234",
            "--clear-only",
        ])
        .output()
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(
        output.status.success(),
        "CLI failed: {stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let requests = server.join().unwrap().unwrap();
    assert!(stdout.contains(&format!("Endpoint: {endpoint} (local S3 mode)")));
    assert!(stdout.contains("Bucket 'fixture' exists"));
    assert!(stdout.contains("Bucket cleared successfully (--clear-only mode)"));
    assert!(!stdout.contains("Could not list bucket contents"));
    assert_eq!(requests[0], "HEAD /fixture/ HTTP/1.1");
    assert!(requests[1].starts_with("GET /fixture/?"));
    assert!(requests[1].contains("list-type=2"));
}
