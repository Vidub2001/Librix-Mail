// Fichier de test des règles librix-rust.yml (semgrep --test), jamais compilé.

fn open_with_system(path: &Path) {
    // ruleid: librix-shell-command
    let mut c = std::process::Command::new("cmd");
    // ruleid: librix-shell-command
    let p = Command::new("powershell");
    // ruleid: librix-shell-command
    let s = Command::new("/bin/sh");
    // ruleid: librix-shell-command
    let z = std::process::Command::new("zsh");
    // ruleid: librix-shell-command
    let w = Command::new("C:\\Windows\\System32\\cmd.exe");
    // ok: librix-shell-command
    let x = std::process::Command::new("xdg-open");
}

fn risky_to_open(name: &str) -> bool {
    // ruleid: librix-extension-denylist
    name.ends_with(".exe")
}

fn safe_types() -> [&'static str; 2] {
    // ok: librix-extension-denylist
    [".pdf", ".png"]
}

pub fn send(method: &str, url: &str, headers: &[(&str, String)]) {
    let mut current = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        // ruleid: librix-auth-redirect
        let response = send_once(&method, &current, headers, body, max_bytes)?;
        if let Some(location) = response.header("location") {
            current = resolve(&current, location);
            continue;
        }
    }
}

fn notify(summary: &str, body: &str) {
    // ruleid: librix-notify-send-args
    let shown = std::process::Command::new("notify-send").arg(summary).arg(body).status();
}

fn notify_ok(summary: &str, body: &str) {
    // ok: librix-notify-send-args
    let shown = std::process::Command::new("notify-send").args(notify_send_args(summary, body, "i", "c")).status();
}
