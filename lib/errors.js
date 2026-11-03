// Turns yt-dlp's error output into a plain-language message.
// `kind` lets the app react: 'age'/'bot' offer browser cookies, 'outdated' offers an update.

const RULES = [
  [/confirm your age|age[- ]?restricted|inappropriate for some users/i, 'age',
    'This video is age-restricted. YouTube only shows it to signed-in adults.'],
  [/not a bot/i, 'bot',
    'YouTube wants to check that you\'re not a bot.'],
  [/could not (copy|find|open).*cookie|failed to decrypt|cookie.*(locked|permission)|unsupported browser/i, 'cookies',
    'Couldn\'t read your browser\'s cookies. Close the browser completely and try again, or pick Firefox.'],
  [/private video|this video is private/i, 'private',
    'This video is private. Only the uploader and people they invited can watch it.'],
  [/members[- ]only|join this channel/i, 'members',
    'This video is for channel members only.'],
  [/not (made )?available in your country|geo[- ]?restrict|blocked it in your country|not available in your region/i, 'region',
    'This video is blocked in your country (region-locked).'],
  [/premieres in|live event will begin|is_upcoming/i, 'upcoming',
    'This is an upcoming premiere or live stream. Try again after it has aired.'],
  [/\bDRM\b/i, 'drm',
    'This is DRM-protected (copy-protected) and can\'t be downloaded.'],
  [/unsupported url/i, 'unsupported',
    'This website or link type isn\'t supported. Use a YouTube or SoundCloud link.'],
  [/video (is )?unavailable|has been removed|no longer available|account .*terminated|does not exist|this track was not found/i, 'unavailable',
    'This video/track is unavailable. It may have been deleted or made private.'],
  [/HTTP Error 404|404: Not Found/i, 'notfound',
    'Nothing was found at this link (404). Check that the link is correct.'],
  [/getaddrinfo|failed to resolve|name or service not known|errno 11001|network is unreachable|timed out|connection (refused|reset|aborted)|unable to connect|remotedisconnected|no route to host|temporary failure in name resolution/i, 'network',
    'Couldn\'t connect. Check your internet connection and try again.'],
  [/no space left|errno 28|not enough space|disk full/i, 'disk',
    'Your disk is full. Free up some space and try again.'],
  [/requested format is not available/i, 'format',
    'That quality or format isn\'t available for this video. Try a different one.'],
  [/nsig|signature extraction|unable to extract|HTTP Error 403|failed to extract any player response|please report this issue/i, 'outdated',
    'The site changed something and yt-dlp couldn\'t handle it. This usually means yt-dlp needs an update.'],
];

// TikTok sometimes refuses requests for a moment, which yt-dlp reports the same way as a site
// change. Telling the user "update yt-dlp" would be misleading, so TikTok lookups get this instead.
const TIKTOK_BUSY = {
  kind: 'tiktok-busy',
  message: 'TikTok didn\'t answer properly (it sometimes blocks downloads for a moment). Wait a minute and try again. If it keeps happening, yt-dlp may need an update.',
};

// `site` is optional; pass 'tiktok' for TikTok lookups (see TIKTOK_BUSY).
function friendlyError(stderr, site) {
  const text = String(stderr || '');
  let error = RULES.find(([pattern]) => pattern.test(text));
  if (error) {
    error = { kind: error[1], message: error[2] };
  } else {
    const errorLine = text.split(/\r?\n/).reverse().find((l) => /ERROR/.test(l)) || text.trim().split(/\r?\n/).pop();
    const detail = (errorLine || 'unknown error').replace(/^.*?ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '');
    error = { kind: 'other', message: `Something went wrong: ${detail}` };
  }
  if (site === 'tiktok' && ['outdated', 'other'].includes(error.kind)) return { ...TIKTOK_BUSY };
  return error;
}

module.exports = { friendlyError };
