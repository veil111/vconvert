// The audio/video formats on offer, how to ask yt-dlp for them, and size estimates.

// `tiktokNote` replaces `note` when the queue is all TikTok links.
const AUDIO_FORMATS = [
  { id: 'mp3', label: 'MP3', ext: 'mp3', note: 'recommended: plays everywhere' },
  { id: 'm4a', label: 'M4A (AAC)', ext: 'm4a', select: 'ba[ext=m4a]/ba/b', note: 'good for Apple devices',
    tiktokNote: "TikTok's original audio, not re-encoded; good for Apple devices" },
  { id: 'opus', label: 'Opus', ext: 'opus', select: 'ba[acodec=opus]/ba/b',
    note: "smallest; YouTube's original audio, not re-encoded", tiktokNote: 'small' },
  { id: 'flac', label: 'FLAC', ext: 'flac', bitrate: 900000,
    note: 'lossless file, but sounds no better than the source; large' },
  { id: 'wav', label: 'WAV', ext: 'wav', noCoverArt: true, note: 'uncompressed, very large, no cover art' },
];

// MP3 quality choices. `bitrate` is the average bits/sec, used for size estimates.
const MP3_QUALITIES = [
  { value: '320K', label: '320 kbps', bitrate: 320000, note: 'largest' },
  { value: '0', label: 'V0 (~245 kbps)', bitrate: 245000, note: 'recommended: sounds the same as 320, smaller' },
  { value: '192K', label: '192 kbps', bitrate: 192000 },
  { value: '128K', label: '128 kbps', bitrate: 128000, note: 'smallest' },
];
const RECOMMENDED_MP3_BITRATE = MP3_QUALITIES[1].bitrate; // V0, used when the quality is unknown

// Guesses used by audioSize() when the site doesn't say.
const FALLBACK_AUDIO_BITRATE = 160000; // bits/sec, typical for M4A/Opus from these sites
const FALLBACK_SAMPLE_RATE = 48000; // samples/sec
const WAV_BYTES_PER_SAMPLE = 4; // 16-bit stereo = 2 bytes x 2 channels

// `tiktokNote` replaces `note` when the queue is all TikTok links.
const VIDEO_FORMATS = [
  { id: 'mp4', label: 'MP4, best quality', container: 'mp4',
    note: 'recommended; 1440p/4K may need VLC or the free AV1 extension',
    tiktokNote: 'recommended; usually H.265, which some players need VLC for' },
  // H.264 is called "avc1" on YouTube and "h264" on TikTok.
  { id: 'compat', label: 'MP4, maximum compatibility (H.264)', container: 'mp4', codec: '^(avc|h264)',
    note: 'plays on everything, usually up to 1080p', tiktokNote: 'plays on everything, usually 720p' },
  { id: 'mkv', label: 'MKV, best quality', container: 'mkv', note: 'plays in VLC and most PC players' },
  { id: 'webm', label: 'WebM, best quality', container: 'webm', ext: 'webm', note: 'for browsers and editors' },
];

const findAudio = (id) => AUDIO_FORMATS.find((f) => f.id === id) || AUDIO_FORMATS[0];
const findVideo = (id) => VIDEO_FORMATS.find((f) => f.id === id) || VIDEO_FORMATS[0];

function mp3Label(value) {
  return MP3_QUALITIES.find((q) => q.value === value)?.label ?? value;
}

// Joins format choices for yt-dlp. "/" means "or, if that isn't available". Repeats are skipped,
// e.g. with no height limit "b" and "b" would otherwise both appear.
const firstAvailable = (...choices) => [...new Set(choices)].join('/');

// yt-dlp format selector for a video format and max height (null = best).
// "bv*" = best video, "ba" = best audio, "b" = best single file with both.
function videoSelector(vf, maxHeight) {
  const h = maxHeight ? `[height<=${maxHeight}]` : '';
  if (vf.codec) {
    // H.264 video + AAC audio; falls back to anything if the site has no H.264.
    return firstAvailable(`bv*[vcodec~='${vf.codec}']${h}+ba[ext=m4a]`, `b[vcodec~='${vf.codec}']${h}`, `bv*${h}+ba`, `b${h}`, 'b');
  }
  if (vf.ext) return firstAvailable(`bv*[ext=${vf.ext}]${h}+ba[ext=${vf.ext}]`, `b[ext=${vf.ext}]${h}`, `bv*${h}+ba`, `b${h}`, 'b');
  return firstAvailable(`bv*${h}+ba`, `b${h}`, 'b');
}

// TikTok offers each video as single files with the picture and sound together, plus a separate
// "sound" track and a watermarked copy (format "download", with TikTok's logo). Always take one
// combined file, so the video keeps its own sound; skip the watermarked copy unless asked for it.
function tiktokSelector(vf, watermark) {
  if (watermark) return firstAvailable('b[format_note*=watermark]', 'b[format_id=download]', 'b');
  const noWatermark = '[format_id!=download]';
  if (vf.codec) return firstAvailable(`b[vcodec~='${vf.codec}']${noWatermark}`, `b${noWatermark}`, 'b');
  return firstAvailable(`b${noWatermark}`, 'b');
}

// TikTok audio: either the sound exactly as heard in the video (taken from the clean video file),
// or TikTok's separate sound file ("ba"), which is often a longer, fuller version of the sound.
function tiktokAudioSelector(fullSound) {
  return fullSound ? firstAvailable('ba', 'b[format_id!=download]', 'b') : firstAvailable('b[format_id!=download]', 'b');
}

function matchesVideoFormat(f, vf) {
  if (!f.vcodec || f.vcodec === 'none' || !f.height) return false;
  if (vf.codec) return new RegExp(vf.codec).test(f.vcodec);
  if (vf.ext) return f.ext === vf.ext;
  return true;
}

// Video heights available for this format, highest first.
function videoHeights(info, vf) {
  const heights = (info.formats || []).filter((f) => matchesVideoFormat(f, vf)).map((f) => f.height);
  return [...new Set(heights)].sort((a, b) => b - a);
}

function formatSize(f, duration) {
  if (!f) return 0;
  if (f.filesize || f.filesize_approx) return f.filesize || f.filesize_approx;
  const kbps = f.abr || f.tbr;
  return kbps && duration ? (kbps * 1000 * duration) / 8 : 0;
}

// Estimated audio file size in bytes (0 = unknown).
function audioSize(info, af, mp3Quality) {
  const d = info.duration;
  if (!d) return 0;
  if (af.id === 'mp3') return (d * (MP3_QUALITIES.find((q) => q.value === mp3Quality)?.bitrate ?? RECOMMENDED_MP3_BITRATE)) / 8;
  if (af.id === 'wav') {
    const audio = (info.formats || []).find((f) => f.asr && f.acodec && f.acodec !== 'none');
    return d * (audio?.asr || FALLBACK_SAMPLE_RATE) * WAV_BYTES_PER_SAMPLE;
  }
  if (af.bitrate) return (d * af.bitrate) / 8;
  // M4A / Opus: the source audio is kept as-is when it's already in that format.
  const audioOnly = (info.formats || []).filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  const want = af.id === 'opus' ? (f) => f.acodec.startsWith('opus') : (f) => f.ext === 'm4a';
  const best = (list) => list.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
  const src = best(audioOnly.filter(want)) || best(audioOnly);
  return formatSize(src, d) || (d * FALLBACK_AUDIO_BITRATE) / 8;
}

module.exports = {
  AUDIO_FORMATS, MP3_QUALITIES, VIDEO_FORMATS,
  findAudio, findVideo, mp3Label,
  videoSelector, tiktokSelector, tiktokAudioSelector, videoHeights, audioSize,
};
