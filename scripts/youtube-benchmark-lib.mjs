export function contentPlaying(state, videoId) {
  return Boolean(state && state.video_id === videoId && state.player_video_id === videoId
    && state.hostname === 'www.youtube.com' && state.pathname === '/watch'
    && !state.ad_showing && state.video && !state.video.paused && !state.video.ended
    && state.video.ready_state >= 2 && Number.isFinite(state.video.current_time));
}

export function playbackVerified(first, second, videoId) {
  return [first, second].every(state => contentPlaying(state, videoId))
    && second.video.current_time - first.video.current_time >= 1;
}

export function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {samples: sorted.length, min_ms: sorted[0],
    median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], max_ms: sorted.at(-1)};
}
