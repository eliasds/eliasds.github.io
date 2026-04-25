/** One-off generator: prints left then right channel <section> HTML for try/index.html templates. */
function channelMarkup(side) {
  var isLeft = side === "left";
  var label = isLeft ? "Left" : "Right";
  var panDefault = isLeft ? "-1" : "1";
  var queueIcon =
    '<svg class="ionicon" width="24" height="24" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="M160 144h288M160 256h288M160 368h288" /><circle cx="80" cy="144" r="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" /><circle cx="80" cy="256" r="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" /><circle cx="80" cy="368" r="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" /></svg>';
  var spotifyIcon =
    '<svg class="ionicon" width="24" height="24" viewBox="0 0 168 168" aria-hidden="true"><circle cx="84" cy="84" r="84" fill="currentColor"></circle><path d="M122.98 117.66a6.22 6.22 0 0 1-8.56 2.08c-23.43-14.32-52.93-17.57-87.68-9.65a6.22 6.22 0 1 1-2.76-12.14c38.01-8.66 70.69-4.97 96.93 11.07a6.22 6.22 0 0 1 2.07 8.64z" fill="#0a0a0b"></path><path d="M135.21 90.89a7.78 7.78 0 0 1-10.7 2.6c-26.82-16.48-67.76-21.25-99.5-11.6a7.78 7.78 0 0 1-4.53-14.88c36.47-11.09 81.93-5.72 112.18 12.85a7.78 7.78 0 0 1 2.55 11.03z" fill="#0a0a0b"></path><path d="M136.27 62.95C104.12 43.87 51.1 42.1 20.4 51.41a9.33 9.33 0 1 1-5.41-17.86C50.53 22.75 108.3 24.79 145.81 47.05a9.33 9.33 0 1 1-9.54 15.9z" fill="#0a0a0b"></path></svg>';
  var addIcon =
    '<svg class="ionicon" width="24" height="24" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M421.84 37.37a25.86 25.86 0 00-22.6-4.46L199.92 86.49A32.3 32.3 0 00176 118v226c0 6.74-4.36 12.56-11.11 14.83l-.12.05-52 18C92.88 383.53 80 402 80 423.91a55.54 55.54 0 0023.23 45.63A54.78 54.78 0 00135.34 480a55.82 55.82 0 0017.75-2.93l.38-.13 21.84-7.94A47.84 47.84 0 00208 423.91v-212c0-7.29 4.77-13.21 12.16-15.07l.21-.06L395 150.14a4 4 0 015 3.86v141.93c0 6.75-4.25 12.38-11.11 14.68l-.25.09-50.89 18.11A49.09 49.09 0 00304 375.92a55.67 55.67 0 0023.23 45.8 54.63 54.63 0 0049.88 7.35l.36-.12 21.84-7.95A47.83 47.83 0 00432 375.92V58a25.74 25.74 0 00-10.16-20.63z" /></svg>';
  var seekBackIcon =
    '<svg class="ionicon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12V22H8V14H6V12H10M12 12H18V14H14V16H16C17.11 16 18 16.9 18 18V20C18 21.11 17.11 22 16 22H12V20H16V18H12V12Z" /></svg>';
  var seekForwardIcon =
    '<svg class="ionicon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.5 3C14.15 3 16.55 4 18.4 5.6L21 3V10H14L16.62 7.38C15.23 6.22 13.46 5.5 11.5 5.5C7.96 5.5 4.95 7.81 3.9 11L1.53 10.22C2.92 6.03 6.85 3 11.5 3M10 12V22H8V14H6V12H10M12 12H18V14H14V16H16C17.11 16 18 16.9 18 18V20C18 21.11 17.11 22 16 22H12V20H16V18H12V12Z" /></svg>';
  var deckLeft =
    '<div class="beta-vol-fader-col"><div class="beta-vol-fader-inner"><div class="beta-vol-fader-slot"><label class="sr-only" for="beta-vol-left">Left volume</label><input id="beta-vol-left" class="beta-vol-slider-vertical" type="range" min="0" max="1" step="0.01" value="1" aria-label="Left volume" /></div></div><span class="beta-vol-label-text">Vol</span></div><div class="beta-bottom-deck-spacer" aria-hidden="true"></div><div class="beta-tools-col"><button type="button" class="beta-tool-btn beta-tool-btn--disabled" id="beta-boost-left" disabled aria-disabled="true" title="Boost coming later" aria-label="Boost (coming later)"><svg class="ionicon beta-boost-icon" width="22" height="22" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M461.81 53.81a4.4 4.4 0 00-3.3-3.39c-54.38-13.3-180 34.09-248.13 102.17a294.9 294.9 0 00-33.09 39.08c-21-1.9-42-.3-59.88 7.5-50.49 22.2-65.18 80.18-69.28 105.07a9 9 0 009.8 10.4l81.07-8.9a180.29 180.29 0 001.1 18.3 18.15 18.15 0 005.3 11.09l31.39 31.39a18.15 18.15 0 0011.1 5.3 179.91 179.91 0 0018.19 1.1l-8.89 81a9 9 0 0010.39 9.79c24.9-4 83-18.69 105.07-69.17 7.8-17.9 9.4-38.79 7.6-59.69a293.91 293.91 0 0039.19-33.09c68.38-68 115.47-190.86 102.37-247.95zM298.66 213.67a42.7 42.7 0 1160.38 0 42.65 42.65 0 01-60.38 0z" /><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M109.64 352a45.06 45.06 0 00-26.35 12.84C65.67 382.52 64 448 64 448s65.52-1.67 83.15-19.31A44.73 44.73 0 00160 402.32" /></svg><span class="beta-tool-btn-label">Boost</span></button><button type="button" class="beta-tool-btn beta-speed-btn" id="beta-speed-left" aria-label="Left playback speed"><span class="beta-tool-btn-label">Speed</span><span class="beta-speed-label">1.0×</span></button></div>';
  var deckRight =
    '<div class="beta-tools-col"><button type="button" class="beta-tool-btn beta-tool-btn--disabled" id="beta-boost-right" disabled aria-disabled="true" title="Boost coming later" aria-label="Boost (coming later)"><svg class="ionicon beta-boost-icon" width="22" height="22" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M461.81 53.81a4.4 4.4 0 00-3.3-3.39c-54.38-13.3-180 34.09-248.13 102.17a294.9 294.9 0 00-33.09 39.08c-21-1.9-42-.3-59.88 7.5-50.49 22.2-65.18 80.18-69.28 105.07a9 9 0 009.8 10.4l81.07-8.9a180.29 180.29 0 001.1 18.3 18.15 18.15 0 005.3 11.09l31.39 31.39a18.15 18.15 0 0011.1 5.3 179.91 179.91 0 0018.19 1.1l-8.89 81a9 9 0 0010.39 9.79c24.9-4 83-18.69 105.07-69.17 7.8-17.9 9.4-38.79 7.6-59.69a293.91 293.91 0 0039.19-33.09c68.38-68 115.47-190.86 102.37-247.95zM298.66 213.67a42.7 42.7 0 1160.38 0 42.65 42.65 0 01-60.38 0z" /><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M109.64 352a45.06 45.06 0 00-26.35 12.84C65.67 382.52 64 448 64 448s65.52-1.67 83.15-19.31A44.73 44.73 0 00160 402.32" /></svg><span class="beta-tool-btn-label">Boost</span></button><button type="button" class="beta-tool-btn beta-speed-btn" id="beta-speed-right" aria-label="Right playback speed"><span class="beta-tool-btn-label">Speed</span><span class="beta-speed-label">1.0×</span></button></div><div class="beta-bottom-deck-spacer" aria-hidden="true"></div><div class="beta-vol-fader-col"><div class="beta-vol-fader-inner"><div class="beta-vol-fader-slot"><label class="sr-only" for="beta-vol-right">Right volume</label><input id="beta-vol-right" class="beta-vol-slider-vertical" type="range" min="0" max="1" step="0.01" value="1" aria-label="Right volume" /></div></div><span class="beta-vol-label-text">Vol</span></div>';
  return (
    '<section class="beta-segment beta-segment--' +
    side +
    '" data-channel="' +
    side +
    '" aria-labelledby="beta-label-' +
    side +
    '"><h2 id="beta-label-' +
    side +
    '" class="beta-channel-label beta-channel-label--' +
    side +
    '">' +
    label +
    '</h2><div class="beta-segment-stack"><div class="beta-transport"><button type="button" class="beta-icon-btn" id="beta-prev-' +
    side +
    '" aria-label="' +
    label +
    ' channel: previous track"><svg class="ionicon" width="32" height="32" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M112 64a16 16 0 0116 16v136.43L360.77 77.11a35.13 35.13 0 0135.77-.44c12 6.8 19.46 20 19.46 34.33v290c0 14.37-7.46 27.53-19.46 34.33a35.14 35.14 0 01-35.77-.45L128 295.57V432a16 16 0 01-32 0V80a16 16 0 0116-16z" /></svg></button><button type="button" class="beta-icon-btn beta-seek-step-btn" id="beta-seekback-' +
    side +
    '" aria-label="' +
    label +
    ' channel: seek back 15 seconds">' +
    seekBackIcon +
    '</button><button type="button" class="beta-icon-btn beta-play-main" id="beta-play-' +
    side +
    '" aria-label="Play ' +
    side +
    ' channel"><svg class="ionicon beta-play-glyph" width="64" height="64" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M133 440a35.37 35.37 0 01-17.5-4.67c-12-6.8-19.46-20-19.46-34.33V111c0-14.37 7.46-27.53 19.46-34.33a35.13 35.13 0 0135.77.45l247.85 148.36a36 36 0 010 61l-247.89 148.4A35.5 35.5 0 01133 440z" /></svg></button><button type="button" class="beta-icon-btn beta-seek-step-btn" id="beta-seekfwd-' +
    side +
    '" aria-label="' +
    label +
    ' channel: seek forward 15 seconds">' +
    seekForwardIcon +
    '</button><button type="button" class="beta-icon-btn" id="beta-next-' +
    side +
    '" aria-label="' +
    label +
    ' channel: next track"><svg class="ionicon" width="32" height="32" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M400 64a16 16 0 00-16 16v136.43L151.23 77.11a35.13 35.13 0 00-35.77-.44C103.46 83.47 96 96.63 96 111v290c0 14.37 7.46 27.53 19.46 34.33a35.14 35.14 0 0035.77-.45L384 295.57V432a16 16 0 0032 0V80a16 16 0 00-16-16z" /></svg></button></div><p id="beta-title-' +
    side +
    '" class="beta-track-title beta-track-title--muted">No track loaded</p><p id="beta-artist-' +
    side +
    '" class="beta-track-artist beta-track-artist--empty" aria-live="polite"></p><div class="beta-progress-wrap" data-side="' +
    side +
    '"><input id="beta-seek-' +
    side +
    '" class="beta-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="' +
    label +
    ' track position" /><div class="beta-progress-times"><span id="beta-time-el-' +
    side +
    '">0:00</span><span id="beta-time-dur-' +
    side +
    '">0:00</span></div></div><div class="beta-bottom-row"><button type="button" class="beta-small-btn" id="beta-queue-' +
    side +
    '" aria-label="Open ' +
    side +
    ' queue">' +
    queueIcon +
    'Queue</button><button type="button" class="beta-small-btn beta-small-btn--spotify" id="beta-spotify-' +
    side +
    '" aria-label="Enable Spotify on ' +
    side +
    ' channel">' +
    spotifyIcon +
    'Spotify</button><input id="beta-file-' +
    side +
    '" class="beta-hidden-file" type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.webm" aria-label="Add audio to ' +
    side +
    ' channel" /><button type="button" class="beta-small-btn" id="beta-load-' +
    side +
    '" aria-label="Add files to ' +
    side +
    ' queue">' +
    addIcon +
    'Add</button></div></div><div class="beta-balance-block"><div class="beta-pan-wrap"><div class="beta-pan-track-bg"></div><div class="beta-pan-center-notch"></div><label class="sr-only" for="beta-pan-' +
    side +
    '">' +
    label +
    ' channel balance</label><input id="beta-pan-' +
    side +
    '" type="range" min="-1" max="1" step="0.01" value="' +
    panDefault +
    '" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="' +
    panDefault +
    '" /></div><span class="beta-balance-label">Balance</span></div><div class="beta-bottom-deck beta-bottom-deck--' +
    side +
    '">' +
    (isLeft ? deckLeft : deckRight) +
    "</div></section>"
  );
}

process.stdout.write("LEFT\n" + channelMarkup("left") + "\nRIGHT\n" + channelMarkup("right") + "\n");
