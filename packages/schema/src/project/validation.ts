import { mediaRangeDetails } from '../assets/video';
import { isDefaultTransform } from '../common';
import { type ProjectShape } from './schema';
import { z } from 'zod';
import { buildProjectIndex } from './indexing';
import { collectVideoDiagnostics } from './../diagnostics/video';
import { isVisualTrack } from './../track';
import { editorialComponentTypeSchema } from './../editorial';
import { educationComponentTypeSchema } from './../education';
import { motionProperties } from './../authoring';
import { legacyNarrationSchema } from './../narration';
import { type CueTarget } from './../narration';
export function validateProject(p: ProjectShape, ctx: z.RefinementCtx) {
  const index = buildProjectIndex(p);
  for (const issue of collectVideoDiagnostics(p, index.assetById))
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: issue.path,
      params: { code: issue.code, details: issue.details },
    });

  const diagnostic = (
    code: string,
    path: (string | number)[],
    message: string,
    details: Record<string, unknown>,
  ) =>
    ctx.addIssue({ code: 'custom', path, message, params: { code, details } });
  const seen = new Map<string, { path: (string | number)[]; kind: string }>();
  const checkId = (value: string, path: (string | number)[], kind: string) => {
    const first = seen.get(value);
    if (first)
      diagnostic('project.id.duplicate', path, `Duplicate ID: ${value}`, {
        id: value,
        firstPath: first.path,
        duplicatePath: path,
        firstKind: first.kind,
        kind,
        remediation:
          'Assign a unique ID to one owner and update its references.',
      });
    else seen.set(value, { path, kind });
  };
  checkId(p.id, ['id'], 'project');
  p.assets.forEach((a, i) => {
    checkId(a.id, ['assets', i, 'id'], 'asset');
    if (a.type === 'composition' && p.version < 7)
      ctx.addIssue({
        code: 'custom',
        message: 'Composition assets require v7',
      });
  });
  if (p.seed !== undefined && p.version < 7)
    ctx.addIssue({ code: 'custom', message: 'Seed requires v7' });
  p.scenes.forEach((s, i) => checkId(s.id, ['scenes', i, 'id'], 'scene'));
  p.markers.forEach((m, i) => checkId(m.id, ['markers', i, 'id'], 'marker'));
  const end = Math.max(...p.scenes.map((s) => s.startFrame + s.durationFrames));
  if (p.camera) {
    if (p.version < 6)
      ctx.addIssue({ code: 'custom', message: 'Camera requires project v6' });
    if (
      p.camera.animations.some((a) => a.keyframes.some((k) => k.frame >= end))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Camera keyframe outside project',
      });
  }
  p.markers.forEach((m) => {
    if (m.frame >= end)
      ctx.addIssue({ code: 'custom', message: 'Marker outside project' });
  });
  const allClips = index.clipById;
  const laidOut = new Set<string>();
  p.scenes.forEach((scene) => {
    if (!scene.layout || typeof scene.layout === 'string') return;
    if (p.version < 3)
      ctx.addIssue({
        code: 'custom',
        message: 'Structured layouts require project v3',
      });
    const l = scene.layout;
    if (l.type === 'split' && l.clipIds.length !== 2)
      ctx.addIssue({
        code: 'custom',
        message: 'Split layout requires two clips',
      });
    const innerWidth = p.canvas.width - 2 * l.padding;
    const innerHeight = p.canvas.height - 2 * l.padding;
    const columns =
      l.type === 'grid'
        ? Math.min(l.columns, l.clipIds.length)
        : l.type === 'split'
          ? 2
          : l.clipIds.length;
    const rows =
      l.type === 'grid' ? Math.ceil(l.clipIds.length / columns) : columns;
    if (
      l.type !== 'absolute' &&
      (innerWidth <= 0 ||
        innerHeight <= 0 ||
        (l.type === 'grid' &&
          (innerWidth <= (columns - 1) * l.gap ||
            innerHeight <= (rows - 1) * l.gap)) ||
        ((l.type === 'stack' || l.type === 'split') &&
          (l.direction === 'horizontal' ? innerWidth : innerHeight) <=
            (columns - 1) * l.gap))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Layout leaves no positive content bounds',
      });
    }
    l.clipIds.forEach((clipId) => {
      if (laidOut.has(clipId))
        ctx.addIssue({
          code: 'custom',
          message: 'Clip belongs to multiple layout slots',
        });
      laidOut.add(clipId);
      const clip = allClips.get(clipId);
      if (
        !clip ||
        clip.startFrame < scene.startFrame ||
        clip.startFrame + clip.durationFrames >
          scene.startFrame + scene.durationFrames
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Layout references require clips contained in the scene',
        });
    });
  });
  p.tracks.forEach((t, ti) => {
    checkId(t.id, ['tracks', ti, 'id'], 'track');
    if (!isVisualTrack(t)) {
      if (p.version < 4 && t.clips.length)
        ctx.addIssue({
          code: 'custom',
          message: 'Audio clips require project v4',
        });
      t.clips.forEach((c, ci) => {
        checkId(c.id, ['tracks', ti, 'clips', ci, 'id'], 'clip');

        const asset = index.assetById.get(c.assetId);
        if (asset && /^(blob:|data:)/i.test(asset.src))
          ctx.addIssue({
            code: 'custom',
            message: 'Audio clips require stable asset references',
          });
        if (!asset || asset.type !== 'audio')
          ctx.addIssue({
            code: 'custom',
            message: 'Audio clip requires an audio asset',
          });
        if (c.startFrame + c.durationFrames > end)
          ctx.addIssue({
            code: 'custom',
            message: 'Audio clip outside project',
          });
        if (
          asset &&
          asset.type !== 'composition' &&
          asset.durationMs !== undefined &&
          c.durationFrames >
            mediaRangeDetails(
              asset.durationMs,
              c.sourceOffsetMs,
              1,
              p.fps,
              c.durationFrames,
              true,
            ).maxPlayableFrames
        )
          diagnostic(
            'audio.source.range',
            ['tracks', ti, 'clips', ci],
            'Audio source range exceeds asset duration',
            {
              ...mediaRangeDetails(
                asset.durationMs!,
                c.sourceOffsetMs,
                1,
                p.fps,
                c.durationFrames,
                true,
              ),
              rounding: 'terminal-partial-frame',
            },
          );
      });
      return;
    }
    t.clips.forEach((c, ci) => {
      if (c.component === 'ForeignComposition') {
        if (c.props.parameters !== undefined && p.version < 8)
          ctx.addIssue({
            code: 'custom',
            message: 'Composition parameters require v8',
          });
        const asset = index.assetById.get(c.props.assetId);
        const scene = p.scenes.find(
          (s) =>
            c.startFrame >= s.startFrame &&
            c.startFrame + c.durationFrames <= s.startFrame + s.durationFrames,
        );
        const path = ['tracks', ti, 'clips', ci];
        const details = {
          clipId: c.id,
          clipInterval: [c.startFrame, c.startFrame + c.durationFrames],
          candidateScenes: p.scenes.map((s) => ({
            id: s.id,
            interval: [s.startFrame, s.startFrame + s.durationFrames],
          })),
        };
        if (p.version < 7)
          diagnostic(
            'composition.version.required',
            path,
            'Foreign compositions require project version 7 or newer',
            { ...details, remediation: 'Migrate the project explicitly.' },
          );
        if (!asset || asset.type !== 'composition')
          diagnostic(
            'composition.asset.type',
            [...path, 'props', 'assetId'],
            'Foreign composition requires a composition asset',
            {
              ...details,
              assetId: c.props.assetId,
              remediation: 'Reference an asset of type composition.',
            },
          );
        if (!scene)
          diagnostic(
            'composition.scene.containment',
            path,
            'Foreign composition must fit entirely within one scene',
            {
              ...details,
              remediation:
                'Shorten or move the clip into one scene, or split it at the scene boundary.',
            },
          );
        if (t.type !== 'visual')
          diagnostic(
            'composition.track.invalid',
            path,
            'Foreign composition requires a visual track',
            { ...details, remediation: 'Move the clip to a visual track.' },
          );
        if (
          c.animations.length ||
          c.motion?.length ||
          c.effects ||
          !isDefaultTransform(c.transform)
        )
          diagnostic(
            'composition.full-stage.required',
            path,
            'Foreign compositions are full-stage layers; clip transforms, animations, motion and effects are unsupported',
            {
              ...details,
              remediation:
                'Use the default clip transform and author motion/effects inside the composition.',
            },
          );
      }
      if (
        p.version < 6 &&
        (c.effects !== undefined ||
          editorialComponentTypeSchema.safeParse(c.component).success)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Editorial components and effects require project v6',
        });
      checkId(c.id, ['tracks', ti, 'clips', ci, 'id'], 'clip');
      if (
        p.version < 5 &&
        educationComponentTypeSchema.safeParse(c.component).success
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Education components require project v5',
        });

      if (
        p.version < 3 &&
        (c.component === 'Path' ||
          c.semantic !== undefined ||
          c.motion !== undefined ||
          ('nodes' in c.props &&
            c.props.nodes.some(
              (n) => 'semantic' in n && n.semantic !== undefined,
            )))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Semantic metadata, paths and motion require project v3',
        });
      const motionProps = new Set<string>();
      c.motion?.forEach((m) => {
        const offset =
          m.preset === 'stagger' ? m.staggerIndex * m.staggerFrames : 0;
        if (m.startFrame + offset + m.durationFrames > c.durationFrames)
          ctx.addIssue({ code: 'custom', message: 'Motion outside clip' });
        motionProperties(m.preset, m.direction).forEach((property) => {
          if (motionProps.has(property))
            ctx.addIssue({
              code: 'custom',
              message: 'Conflicting motion presets',
            });
          motionProps.add(property);
        });
      });
      if (
        p.version === 1 &&
        (!['Text', 'Shape', 'Arrow'].includes(c.component) ||
          (c.component === 'Text' && c.props.fontFamily !== undefined))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Developer components and font metadata require project v2',
        });
      if (c.startFrame + c.durationFrames > end)
        ctx.addIssue({
          code: 'custom',
          message: `Clip ${c.id} exceeds scene timeline`,
        });
      const properties = new Set<string>();
      c.animations.forEach((a) => {
        if (properties.has(a.property))
          ctx.addIssue({
            code: 'custom',
            message: 'Duplicate animated property',
          });
        properties.add(a.property);
        if (a.keyframes.some((k) => k.frame >= c.durationFrames))
          ctx.addIssue({ code: 'custom', message: 'Keyframe outside clip' });
      });
    });
  });
  const scenes = index.sceneById;
  const clips = index.allClipIds;
  p.narration?.segments.forEach((s, si) => {
    checkId(s.id, ['narration', 'segments', si, 'id'], 'narration');
    if (s.sceneId && !scenes.has(s.sceneId))
      ctx.addIssue({ code: 'custom', message: 'Unknown narration scene' });
    const linked = s.audioClipId
      ? index.audioClipById.get(s.audioClipId)
      : undefined;
    if (s.audioClipId && (!linked || !index.voiceClipIds.has(s.audioClipId)))
      ctx.addIssue({
        code: 'custom',
        message: 'Narration must link a voice clip',
      });
    if (s.audioAssetId && index.assetById.get(s.audioAssetId)?.type !== 'audio')
      ctx.addIssue({
        code: 'custom',
        message: 'Unknown narration audio asset',
      });
    if (
      linked &&
      ((s.audioAssetId && s.audioAssetId !== linked.assetId) ||
        (s.startFrame !== undefined && s.startFrame !== linked.startFrame) ||
        (s.durationFrames !== undefined &&
          s.durationFrames !== linked.durationFrames))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Narration placement must agree with audio clip',
      });
    const start = linked?.startFrame ?? s.startFrame ?? 0;
    const duration =
      ((linked?.durationFrames ?? s.durationFrames ?? end - start) * 1000) /
      p.fps;
    if (start + (linked?.durationFrames ?? s.durationFrames ?? 0) > end)
      ctx.addIssue({ code: 'custom', message: 'Narration outside project' });
    for (const timings of [s.words, s.phrases])
      timings?.forEach((w, i) => {
        if (w.endMs > duration || (i > 0 && w.startMs < timings[i - 1]!.endMs))
          ctx.addIssue({
            code: 'custom',
            message:
              'Speech timings overlap, are unordered, or exceed narration duration',
          });
      });
    if (
      p.version < 4 &&
      !legacyNarrationSchema.safeParse({ segments: [s] }).success
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Rich narration requires project v4',
      });
    const checkTarget = (target: CueTarget) => {
      if (target.kind === 'semantic') {
        if (target.clipId && !allClips.has(target.clipId))
          ctx.addIssue({ code: 'custom', message: 'Unknown semantic clip' });
        return;
      }
      const clip = allClips.get(target.clipId);
      if (
        !clip ||
        (target.kind === 'node' &&
          (!('nodes' in clip.props) ||
            !clip.props.nodes.some((n) => n.id === target.nodeId))) ||
        (target.kind === 'edge' &&
          (!('edges' in clip.props) ||
            !clip.props.edges.some((e) => e.id === target.edgeId)))
      )
        ctx.addIssue({ code: 'custom', message: 'Unknown cue target' });
    };
    s.phraseMappings?.forEach((m) => checkTarget(m.target));
    s.cues?.forEach((c, qi) => {
      checkId(c.id, ['narration', 'segments', si, 'cues', qi, 'id'], 'cue');

      if ('targetId' in c) {
        if (!clips.has(c.targetId))
          ctx.addIssue({ code: 'custom', message: 'Unknown cue target' });
      } else checkTarget(c.target);
      const last = 'range' in c && c.range ? c.range.endMs : c.atMs;
      if (last !== undefined && last > duration)
        ctx.addIssue({ code: 'custom', message: 'Cue outside narration' });
    });
  });
}
