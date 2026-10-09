use std::time::Duration;

pub const METRICS_OUTPUT_START: &str = "__SERVER_PILOT_METRICS_START__";
pub const METRICS_OUTPUT_END: &str = "__SERVER_PILOT_METRICS_END__";
pub const SSH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Validate a remote identifier (container name/id, systemd unit, ...) before
/// interpolating it into a shell command. Accepts only characters that are
/// valid in docker names/ids and systemd unit names, so command injection via
/// metacharacters (`;`, `|`, `$`, backticks, whitespace, ...) is impossible.
pub fn validate_shell_identifier<'a>(value: &'a str, kind: &str) -> Result<&'a str, String> {
    const MAX_LEN: usize = 256;
    if value.is_empty() || value.len() > MAX_LEN {
        return Err(format!("Invalid {}: empty or too long", kind));
    }
    let valid = value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '@' | '\\'));
    if !valid {
        return Err(format!(
            "Invalid {}: only letters, digits and _ - . : @ \\\\ are allowed",
            kind
        ));
    }
    Ok(value)
}

pub fn read_between_markers<'a>(
    output: &'a str,
    start_marker: &str,
    end_marker: &str,
) -> Result<&'a str, String> {
    let start = output
        .find(start_marker)
        .ok_or_else(|| "Output start marker not found".to_string())?;
    let content_start = start + start_marker.len();
    // Search for the end marker *after* the start marker so a stale end marker
    // appearing earlier in the output cannot invalidate the extraction.
    let end = output[content_start..]
        .find(end_marker)
        .map(|offset| content_start + offset)
        .ok_or_else(|| "Output end marker not found".to_string())?;

    Ok(&output[content_start..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("plain"), "'plain'");
    }

    #[test]
    fn validate_shell_identifier_rejects_metacharacters() {
        assert!(validate_shell_identifier("nginx.service", "service").is_ok());
        assert!(validate_shell_identifier("abc123", "container").is_ok());
        assert!(validate_shell_identifier("x; rm -rf ~", "container").is_err());
        assert!(validate_shell_identifier("$(whoami)", "container").is_err());
        assert!(validate_shell_identifier("", "container").is_err());
    }

    #[test]
    fn read_between_markers_ignores_earlier_end_marker() {
        let output = "noise END more START content END trailing";
        assert_eq!(
            read_between_markers(output, "START", "END").unwrap(),
            " content "
        );
    }
}
