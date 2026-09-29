import { localProjectReferenceSchema } from './../common';
import { normalizedCropSchema } from './../assets/video';
/** Media-specific machine diagnostics supplement strict project validation, without reading bytes. */
export function collectVideoDiagnostics(
  input: unknown,
  assetIndex?: ReadonlyMap<unknown, unknown>,
): { code: string; path: (string | number)[]; message: string }[] {
  const record = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const p = record(input),
    assets = Array.isArray(p.assets) ? p.assets.map(record) : [];
  const errors: { code: string; path: (string | number)[]; message: string }[] =
    [];
  const issue = (code: string, path: (string | number)[]) =>
    errors.push({ code, path, message: code });
  const assetById = assetIndex ?? new Map(assets.map((a) => [a.id, a]));
  assets.forEach((asset, i) => {
    if (asset.type !== 'video') return;
    if (typeof p.version === 'number' && p.version < 9)
      issue('video.version.required', ['assets', i]);
    if (!localProjectReferenceSchema.safeParse(asset.src).success)
      issue('video.asset.path', ['assets', i, 'src']);
    if (
      typeof asset.durationMs !== 'number' ||
      !Number.isFinite(asset.durationMs) ||
      asset.durationMs <= 0
    )
      issue('video.source.duration', ['assets', i, 'durationMs']);
  });
  (Array.isArray(p.tracks) ? p.tracks : []).forEach((raw, ti) => {
    const track = record(raw);
    (Array.isArray(track.clips) ? track.clips : []).forEach((rawClip, ci) => {
      const clip = record(rawClip);
      if (clip.component !== 'Video') return;
      const props = record(clip.props),
        path = ['tracks', ti, 'clips', ci, 'props'];
      const rawAsset = assetById.get(props.assetId);
      const asset = rawAsset === undefined ? undefined : record(rawAsset);
      if (typeof p.version === 'number' && p.version < 9)
        issue('video.version.required', ['tracks', ti, 'clips', ci]);
      if (track.type !== 'visual')
        issue('video.track.invalid', ['tracks', ti, 'clips', ci]);
      if (!asset) issue('video.asset.missing', [...path, 'assetId']);
      else if (asset.type !== 'video')
        issue('video.asset.type', [...path, 'assetId']);
      if (
        typeof props.sourceInMs !== 'number' ||
        !Number.isFinite(props.sourceInMs) ||
        props.sourceInMs < 0
      )
        issue('video.source.in', [...path, 'sourceInMs']);
      if (
        typeof props.playbackRate !== 'number' ||
        !Number.isFinite(props.playbackRate) ||
        props.playbackRate < 0.25 ||
        props.playbackRate > 4
      )
        issue('video.playbackRate.unsupported', [...path, 'playbackRate']);
      if (
        props.crop !== undefined &&
        !normalizedCropSchema.safeParse(props.crop).success
      )
        issue('video.crop.invalid', [...path, 'crop']);
      if (
        asset?.type === 'video' &&
        typeof asset.durationMs === 'number' &&
        typeof p.fps === 'number' &&
        p.fps > 0 &&
        typeof clip.durationFrames === 'number' &&
        typeof props.sourceInMs === 'number' &&
        typeof props.playbackRate === 'number' &&
        props.sourceInMs +
          (clip.durationFrames / p.fps) * 1000 * props.playbackRate >
          asset.durationMs + 1e-6
      )
        issue('video.source.range', path);
    });
  });
  return errors;
}
export function videoDiagnostics(input: unknown) {
  return collectVideoDiagnostics(input);
}
