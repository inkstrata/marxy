//! What an EXIF block says for the file card, formatted for reading: the camera, the exposure, when, and where.

use std::io::{Cursor, Read, Seek};

use serde::Serialize;

use crate::decode::tiff::{self, Ifd, Tiff};

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exif {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aperture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iso: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taken: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub software: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Location {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ExifRead {
    pub orientation: Option<u16>,
    pub exif: Option<Exif>,
    pub location: Option<Location>,
}

const MAKE: u16 = 0x010F;
const MODEL: u16 = 0x0110;
const SOFTWARE: u16 = 0x0131;
const DATE_TIME: u16 = 0x0132;
const EXPOSURE_TIME: u16 = 0x829A;
const F_NUMBER: u16 = 0x829D;
const ISO: u16 = 0x8827;
const DATE_TIME_ORIGINAL: u16 = 0x9003;
const FOCAL_LENGTH: u16 = 0x920A;
const LENS_MAKE: u16 = 0xA433;
const LENS_MODEL: u16 = 0xA434;

/// A number with at most one decimal, and none when it is whole: 2.8, 8, 35.
fn short_number(v: f64) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r.fract() == 0.0 {
        format!("{r:.0}")
    } else {
        format!("{r:.1}")
    }
}

pub fn exposure(seconds: f64) -> Option<String> {
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    Some(if seconds < 1.0 {
        format!("1/{} s", (1.0 / seconds).round())
    } else {
        format!("{} s", short_number(seconds))
    })
}

/// `2024:05:01 12:34:56` as `2024-05-01 12:34:56`; anything else as written.
fn taken(raw: String) -> String {
    let b = raw.as_bytes();
    if b.len() >= 10 && b[..10].is_ascii() && b[4] == b':' && b[7] == b':' {
        format!("{}-{}-{}{}", &raw[..4], &raw[5..7], &raw[8..10], &raw[10..])
    } else {
        raw
    }
}

fn camera(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) => {
            if model.to_lowercase().starts_with(&make.to_lowercase()) {
                Some(model)
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (make, model) => model.or(make),
    }
}

fn first_number<R: Read + Seek>(t: &mut Tiff<R>, ifd: &Ifd, tag: u16) -> Option<f64> {
    let e = *ifd.get(tag)?;
    t.numbers(&e).first().copied().filter(|v| v.is_finite())
}

fn coordinate<R: Read + Seek>(
    t: &mut Tiff<R>,
    gps: &Ifd,
    reference: u16,
    value: u16,
    negative: char,
    limit: f64,
) -> Option<f64> {
    let e = *gps.get(value)?;
    let parts = t.numbers(&e);
    let [d, m, s] = parts[..] else {
        return None;
    };
    let mut v = d + m / 60.0 + s / 3600.0;
    if t.text_of(gps, reference)
        .is_some_and(|r| r.starts_with(negative))
    {
        v = -v;
    }
    (v.is_finite() && v.abs() <= limit).then_some(v)
}

/// The EXIF facts of the TIFF structure `t`, from IFD0 and its EXIF and GPS IFDs.
pub fn from_tiff<R: Read + Seek>(t: &mut Tiff<R>) -> ExifRead {
    let first = t.first;
    let Ok(ifd0) = t.ifd(first) else {
        return ExifRead::default();
    };
    let orientation = t
        .uint_of(&ifd0, tiff::ORIENTATION)
        .filter(|o| (1..=8).contains(o))
        .map(|o| o as u16);
    let make = t.text_of(&ifd0, MAKE);
    let model = t.text_of(&ifd0, MODEL);
    let mut out = Exif {
        camera: camera(make, model),
        software: t.text_of(&ifd0, SOFTWARE),
        taken: t.text_of(&ifd0, DATE_TIME).map(taken),
        ..Exif::default()
    };
    if let Some(sub) = t.uint_of(&ifd0, tiff::EXIF_IFD).and_then(|o| t.ifd(o).ok()) {
        out.exposure = first_number(t, &sub, EXPOSURE_TIME).and_then(exposure);
        out.aperture = first_number(t, &sub, F_NUMBER)
            .filter(|f| *f > 0.0)
            .map(|f| format!("f/{}", short_number(f)));
        out.iso = t.uint_of(&sub, ISO).filter(|i| *i > 0);
        out.focal_length = first_number(t, &sub, FOCAL_LENGTH)
            .filter(|f| *f > 0.0)
            .map(|f| format!("{} mm", short_number(f)));
        if let Some(original) = t.text_of(&sub, DATE_TIME_ORIGINAL) {
            out.taken = Some(taken(original));
        }
        out.lens = t
            .text_of(&sub, LENS_MODEL)
            .or_else(|| t.text_of(&sub, LENS_MAKE));
    }
    let location = t
        .uint_of(&ifd0, tiff::GPS_IFD)
        .and_then(|o| t.ifd(o).ok())
        .and_then(|gps| {
            Some(Location {
                lat: coordinate(t, &gps, 1, 2, 'S', 90.0)?,
                lon: coordinate(t, &gps, 3, 4, 'W', 180.0)?,
            })
        });
    ExifRead {
        orientation,
        exif: (out != Exif::default()).then_some(out),
        location,
    }
}

/// The EXIF facts of a block held in memory: TIFF bytes, with or without JPEG's `Exif\0\0` in front.
pub fn from_bytes(bytes: &[u8]) -> ExifRead {
    let bytes = bytes.strip_prefix(b"Exif\0\0").unwrap_or(bytes);
    match Tiff::new(Cursor::new(bytes), 0) {
        Ok(Some(mut t)) => from_tiff(&mut t),
        _ => ExifRead::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_formatted_for_reading() {
        assert_eq!(exposure(1.0 / 250.0).as_deref(), Some("1/250 s"));
        assert_eq!(exposure(0.004).as_deref(), Some("1/250 s"));
        assert_eq!(exposure(2.0).as_deref(), Some("2 s"));
        assert_eq!(exposure(1.3).as_deref(), Some("1.3 s"));
        assert_eq!(exposure(0.0), None);
        assert_eq!(short_number(2.8), "2.8");
        assert_eq!(short_number(8.0), "8");
        assert_eq!(taken("2024:05:01 12:34:56".into()), "2024-05-01 12:34:56");
        assert_eq!(
            camera(Some("Canon".into()), Some("Canon EOS R5".into())).as_deref(),
            Some("Canon EOS R5")
        );
        assert_eq!(
            camera(Some("NIKON CORPORATION".into()), Some("NIKON Z 6".into())).as_deref(),
            Some("NIKON CORPORATION NIKON Z 6")
        );
        assert_eq!(from_bytes(b"not exif"), ExifRead::default());
    }
}
