export * from './editorial';
export * from './education';
export * from './authoring';
export * from './developer';
export { CURRENT_PROJECT_VERSION } from './version';
export { localProjectReferenceSchema } from './common';
export { visualEffectsSchema } from './common';
export { type VisualEffects } from './common';
export { transformSchema } from './common';
export { type Transform } from './common';
export { compositionParameterValueSchema } from './assets/composition';
export { compositionParameterValuesSchema } from './assets/composition';
export { compositionParameterSchema } from './assets/composition';
export { compositionManifestSchema } from './assets/composition';
export { resolveCompositionParameters } from './assets/composition';
export { type CompositionManifest } from './assets/composition';
export { easingSchema } from './animation';
export { type EasingName } from './animation';
export { animationPropertySchema } from './animation';
export { type AnimationProperty } from './animation';
export { animationSchema } from './animation';
export { type AnimationTrack } from './animation';
export { cameraAnimationSchema } from './camera';
export { cameraSchema } from './camera';
export { type CameraState } from './camera';
export { type CameraAnimation } from './camera';
export { primitiveClipSchema } from './clips/primitive';
export { type PrimitiveClip } from './clips/primitive';
export { normalizedCropSchema } from './assets/video';
export { type NormalizedCrop } from './assets/video';
export { videoPropsSchema } from './assets/video';
export { videoAssetSchema } from './assets/video';
export { type VideoAsset } from './assets/video';
export { type VideoProps } from './assets/video';
export { videoSourceTimeMs } from './assets/video';
export { videoSourceOutMs } from './assets/video';
export { clipSchema } from './clips/domain';
export { type Clip } from './clips/domain';
export { wordTimingSchema } from './narration';
export { cueTargetSchema } from './narration';
export { type CueTarget } from './narration';
export { semanticCueSchema } from './narration';
export { type SemanticCue } from './narration';
export { phraseTimingSchema } from './narration';
export { phraseMappingSchema } from './narration';
export { narrationSchema } from './narration';
export { type NarrationDocument } from './narration';
export { type WordTiming } from './narration';
export { audioClipSchema } from './track';
export { type AudioClip } from './track';
export { trackSchema } from './track';
export { type Track } from './track';
export { type VisualTrack } from './track';
export { type AudioTrack } from './track';
export { isVisualTrack } from './track';
export { isAudioTrack } from './track';
export { visualClips } from './track';
export { projectSchema } from './project/schema';
export { type VideoProject } from './project/schema';
export { migrateProject } from './project/migration';
export { parseProject } from './project/migration';
export { serializeProject } from './project/migration';
export { videoDiagnostics } from './diagnostics/video';

export {
  componentPropsSchema,
  componentTypes,
  componentClipSchema,
  type ComponentPropsSchema,
} from './clips/domain';
export { DEFAULT_TRANSFORM, isDefaultTransform } from './common';
export type NarrationSegment =
  import('./narration').NarrationDocument['segments'][number];
