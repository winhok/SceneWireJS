import { z } from 'zod';
import { baseClip } from './primitive';
import { videoPropsSchema } from './../assets/video';
import { id } from './../common';
import { compositionParameterValuesSchema } from './../assets/composition';
import { primitiveClipSchema } from './primitive';
import { heroTextPropsSchema } from './../editorial';
import { editorialParagraphPropsSchema } from './../editorial';
import { floatingCardPropsSchema } from './../editorial';
import { chatCardPropsSchema } from './../editorial';
import { chartCardPropsSchema } from './../editorial';
import { diagramCardPropsSchema } from './../editorial';
import { brandOutroPropsSchema } from './../editorial';
import { thermometerPropsSchema } from './../education';
import { flamePropsSchema } from './../education';
import { dropletPropsSchema } from './../education';
import { steamPropsSchema } from './../education';
import { magnifierPropsSchema } from './../education';
import { heatWavePropsSchema } from './../education';
import { cutawayDiagramPropsSchema } from './../education';
import { scientificChartPropsSchema } from './../education';
import { annotationPropsSchema } from './../education';
import { codePropsSchema } from './../developer';
import { terminalPropsSchema } from './../developer';
import { diagramPropsSchema } from './../developer';
import { calloutPropsSchema } from './../developer';
import { metricPropsSchema } from './../developer';
import { browserPropsSchema } from './../developer';
export const clipSchema = z.discriminatedUnion('component', [
  z
    .object({
      ...baseClip,
      component: z.literal('Video'),
      props: videoPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('ForeignComposition'),
      props: z
        .object({
          assetId: id,
          placement: z.enum(['background', 'foreground', 'replace-scene']),
          parameters: compositionParameterValuesSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  ...primitiveClipSchema.options,
  z
    .object({
      ...baseClip,
      component: z.literal('HeroText'),
      props: heroTextPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('EditorialParagraph'),
      props: editorialParagraphPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('FloatingCard'),
      props: floatingCardPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('ChatCard'),
      props: chatCardPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('ChartCard'),
      props: chartCardPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('DiagramCard'),
      props: diagramCardPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('BrandOutro'),
      props: brandOutroPropsSchema,
    })
    .strict(),

  z
    .object({
      ...baseClip,
      component: z.literal('Thermometer'),
      props: thermometerPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Flame'),
      props: flamePropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Droplet'),
      props: dropletPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Steam'),
      props: steamPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Magnifier'),
      props: magnifierPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('HeatWave'),
      props: heatWavePropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('CutawayDiagram'),
      props: cutawayDiagramPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('ScientificChart'),
      props: scientificChartPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Annotation'),
      props: annotationPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('CodeWindow'),
      props: codePropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Terminal'),
      props: terminalPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('FlowDiagram'),
      props: diagramPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('ArchitectureDiagram'),
      props: diagramPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('RAGPipeline'),
      props: diagramPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('AgentGraph'),
      props: diagramPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Callout'),
      props: calloutPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('MetricCard'),
      props: metricPropsSchema,
    })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('BrowserFrame'),
      props: browserPropsSchema,
    })
    .strict(),
]);
export type Clip = z.infer<typeof clipSchema>;

const componentSchemas = new Map(
  clipSchema.options.map((option) => [option.shape.component.value, option]),
);
export const componentTypes = Object.freeze([...componentSchemas.keys()]);
/** Full component schema retained for existing authoring metadata consumers. */
export function componentClipSchema(type: Clip['component']) {
  const schema = componentSchemas.get(type);
  if (!schema) throw Error(`Unknown component: ${type}`);
  return schema;
}
export type ComponentPropsSchema = ReturnType<
  typeof componentClipSchema
>['shape']['props'];
export function componentPropsSchema(
  type: Clip['component'],
): ComponentPropsSchema {
  return componentClipSchema(type).shape.props;
}
