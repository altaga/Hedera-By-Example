//! HCS-7 WASM router (https://hol.org/docs/standards/hcs-7/) for M6 Lab 09.
//!
//! It exports the interface the HCS-7 WasmBridge calls (wasm-bindgen string ABI):
//!   process_state(state_json, messages_json) -> topic ID of the variant to render
//!   get_params() -> the state the router needs
//! and the helpers __wbindgen_malloc / _realloc / _free / _add_to_stack_pointer.
//!
//! Rule: if the HBAR price (latestAnswer, 8 decimals) is at least $0.10, pick the
//! variant registered with the tag "aura:solar"; otherwise the one tagged "aura:obsidian".
//! Written with no_std and no dependencies so the module stays tiny (it is inscribed with HCS-1).

#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }

const THRESHOLD: i128 = 10_000_000; // $0.10 with 8 decimals

static mut STACK: [u8; 4096] = [0; 4096];
static mut SP: usize = 4096;

#[no_mangle]
pub unsafe extern "C" fn __wbindgen_add_to_stack_pointer(delta: i32) -> i32 {
    SP = (SP as i32 + delta) as usize;
    (core::ptr::addr_of_mut!(STACK) as *mut u8).add(SP) as i32
}

// A bump allocator over a static arena: each call is short-lived, so memory is never reused.
static mut HEAP: [u8; 65536] = [0; 65536];
static mut NEXT: usize = 0;

#[no_mangle]
pub unsafe extern "C" fn __wbindgen_malloc(size: usize, align: usize) -> *mut u8 {
    let align = if align == 0 { 1 } else { align };
    let start = (NEXT + align - 1) / align * align;
    if start + size > HEAP.len() { core::arch::wasm32::unreachable() }
    NEXT = start + size;
    (core::ptr::addr_of_mut!(HEAP) as *mut u8).add(start)
}

#[no_mangle]
pub unsafe extern "C" fn __wbindgen_realloc(ptr: *mut u8, old: usize, new: usize, align: usize) -> *mut u8 {
    let fresh = __wbindgen_malloc(new, align);
    core::ptr::copy_nonoverlapping(ptr, fresh, if old < new { old } else { new });
    fresh
}

#[no_mangle]
pub unsafe extern "C" fn __wbindgen_free(_ptr: *mut u8, _size: usize, _align: usize) {}

unsafe fn read(ptr: *const u8, len: usize) -> &'static str {
    core::str::from_utf8_unchecked(core::slice::from_raw_parts(ptr, len))
}

// Writes `s` into fresh memory and stores (ptr, len) at retptr, as wasm-bindgen does.
unsafe fn ret(retptr: *mut i32, s: &str) {
    let ptr = __wbindgen_malloc(s.len(), 1);
    core::ptr::copy_nonoverlapping(s.as_ptr(), ptr, s.len());
    *retptr = ptr as i32;
    *retptr.add(1) = s.len() as i32;
}

// The integer after "latestAnswer":"  (the bridge passes values as strings).
fn price(state: &str) -> Option<i128> {
    let key = "\"latestAnswer\":\"";
    let bytes = &state.as_bytes()[state.find(key)? + key.len()..];
    let (negative, digits) = if bytes.first() == Some(&b'-') { (true, &bytes[1..]) } else { (false, bytes) };
    let mut value: i128 = 0;
    let mut seen = false;
    for b in digits.iter().take_while(|b| b.is_ascii_digit()) {
        value = value * 10 + (b - b'0') as i128;
        seen = true;
    }
    if !seen { return None; }
    Some(if negative { -value } else { value })
}

// The t_id of the registered message whose tags contain `tag` (t_id comes before d.tags).
fn topic_for_tag<'a>(messages: &'a str, quoted_tag: &str) -> Option<&'a str> {
    let at = messages.find(quoted_tag)?;
    let key = "\"t_id\":\"";
    let start = messages[..at].rfind(key)? + key.len();
    let end = start + messages[start..].find('"')?;
    Some(&messages[start..end])
}

#[no_mangle]
pub unsafe extern "C" fn process_state(retptr: *mut i32, s_ptr: *const u8, s_len: usize, m_ptr: *const u8, m_len: usize) {
    let state = read(s_ptr, s_len);
    let messages = read(m_ptr, m_len);
    let tag = match price(state) { Some(p) if p >= THRESHOLD => "\"aura:solar\"", _ => "\"aura:obsidian\"" };
    ret(retptr, topic_for_tag(messages, tag).unwrap_or(""));
}

#[no_mangle]
pub unsafe extern "C" fn get_params(retptr: *mut i32) {
    ret(retptr, "{\"latestAnswer\":\"int256\"}");
}
