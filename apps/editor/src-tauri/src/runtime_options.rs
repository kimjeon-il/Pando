// Probe arguments and their state are compiled only into explicit verification builds.
#[cfg(feature = "verification")]
use std::path::PathBuf;
#[cfg(feature = "verification")]
#[derive(Debug, Default)]
pub struct RuntimeOptions {
    pub auto: bool,
    pub physical_immediate: bool,
    pub probe_hold_ms: u64,
    pub profile_id: Option<String>,
    pub diagnostic_output: Option<PathBuf>,
}

#[cfg(feature = "verification")]
pub fn parse(args: impl IntoIterator<Item = std::ffi::OsString>) -> Result<RuntimeOptions, String> {
    let mut options = RuntimeOptions::default();
    {
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if arg == "--probe-auto" {
                options.auto = true;
            } else if arg == "--probe-physical-immediate" {
                options.physical_immediate = true;
            } else if arg == "--probe-hold-ms" {
                let requested = args.next().ok_or("--probe-hold-ms requires milliseconds")?;
                let duration = requested.to_string_lossy().parse::<u64>()
                    .map_err(|_| "--probe-hold-ms must be an integer")?;
                if !(1000..=30_000).contains(&duration) {
                    return Err("--probe-hold-ms must be between 1000 and 30000".into());
                }
                options.probe_hold_ms = duration;
            } else if arg == "--probe-profile-id" {
                let requested = args.next().ok_or("--probe-profile-id requires an identifier")?;
                let value = requested.to_string_lossy();
                if value.len() > 24 || value.is_empty()
                    || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                    return Err("Invalid probe profile identifier".into());
                }
                options.profile_id = Some(value.to_string());
            } else if arg == "--diagnostic-output" {
                let path = PathBuf::from(
                    args.next()
                        .ok_or("--diagnostic-output requires an absolute filename")?,
                );
                if !path.is_absolute() || path.file_name().is_none() {
                    return Err("Diagnostic output must be an absolute filename".into());
                }
                options.diagnostic_output = Some(path);
            } else if arg.to_string_lossy().starts_with("--probe-") {
                return Err(format!("Unsupported verification option: {}", arg.to_string_lossy()));
            }
        }
        if !options.auto && (options.physical_immediate
            || options.probe_hold_ms > 0 || options.profile_id.is_some()) {
            return Err("Performance flags require --probe-auto".into());
        }
    }
    Ok(options)
}

#[cfg(not(feature = "verification"))]
#[derive(Debug, Default)]
pub struct RuntimeOptions;

#[cfg(not(feature = "verification"))]
pub fn parse(args: impl IntoIterator<Item = std::ffi::OsString>) -> Result<RuntimeOptions, String> {
    for arg in args {
        let value = arg.to_string_lossy();
        if value.starts_with("--probe-") || value.starts_with("--diagnostic-output") {
            return Err(format!("Unsupported verification option in ordinary app: {value}"));
        }
    }
    Ok(RuntimeOptions)
}

#[cfg(test)]
mod tests {
    use super::parse;
    fn args(values: &[&str]) -> Vec<std::ffi::OsString> { values.iter().map(Into::into).collect() }
    #[test]
    fn ordinary_launch_has_no_probe_work() { assert!(parse(args(&[])).is_ok()); }
    #[cfg(not(feature = "verification"))]
    #[test]
    fn ordinary_build_rejects_all_probe_options() {
        for value in ["--probe-auto", "--probe-hold-ms=12000", "--diagnostic-output", "--probe-reference-analysis"] {
            assert!(parse(args(&[value])).unwrap_err().contains("Unsupported verification option"));
        }
    }
    #[cfg(feature = "verification")]
    #[test]
    fn verification_options_retain_validation() {
        assert!(parse(args(&["--probe-auto", "--probe-retired"])).is_err());
        assert!(parse(args(&["--probe-hold-ms", "1000"])).is_err());
        assert!(parse(args(&["--probe-auto", "--probe-hold-ms", "999"])).is_err());
        let value = parse(args(&["--probe-auto", "--probe-hold-ms", "1000"])).unwrap();
        assert!(value.auto);
        assert_eq!(value.probe_hold_ms, 1000);
    }
}
