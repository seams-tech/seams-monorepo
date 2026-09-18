//! Native Rust link/load check for the Moonshine 0.0.71 evaluation artifact.

#[link(name = "moonshine")]
unsafe extern "C" {
    fn moonshine_get_version() -> i32;
}

fn main() -> Result<(), String> {
    // The pinned C ABI declares a parameter-free function returning int32_t.
    let version = unsafe { moonshine_get_version() };
    if version != 20_000 {
        return Err(format!(
            "expected Moonshine C ABI 20000, received {version}"
        ));
    }
    println!("Moonshine native C ABI {version}: Rust link/load check passed");
    Ok(())
}
