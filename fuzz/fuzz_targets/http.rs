//! Une réponse HTTP brute : en-têtes, longueur annoncée, découpage `chunked`
//! (`http.rs`, `oauth.rs`).
#![no_main]

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    librixmail_lib::fuzz_api::http(data);
});
