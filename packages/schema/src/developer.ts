import { z } from 'zod';
export const developerComponentTypeSchema = z.enum([
  'CodeWindow',
  'Terminal',
  'BrowserFrame',
  'FlowDiagram',
  'ArchitectureDiagram',
  'RAGPipeline',
  'AgentGraph',
  'Callout',
  'MetricCard',
]);
export type DeveloperComponentType = z.infer<
  typeof developerComponentTypeSchema
>;
import { semanticMetadataSchema } from './authoring';
const id = z.string().min(1).max(100);
const label = z.string().min(1).max(200);
export const graphNodeSchema = z
  .object({
    id,
    label,
    semantic: semanticMetadataSchema.optional(),
    kind: z
      .enum([
        'service',
        'database',
        'queue',
        'api',
        'client',
        'agent',
        'tool',
        'mcp',
        'memory',
        'llm',
        'human',
      ])
      .default('service'),
  })
  .strict();
export const graphEdgeSchema = z
  .object({ id, from: id, to: id, label: z.string().max(80).default('') })
  .strict();
export const diagramPropsSchema = z
  .object({
    nodes: z.array(graphNodeSchema).min(1).max(12),
    edges: z.array(graphEdgeSchema).max(30),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    activeNodeId: id.optional(),
    activeEdgeId: id.optional(),
    stepReveal: z.boolean().default(false),
    groups: z
      .array(z.object({ id, label, nodeIds: z.array(id).min(1) }).strict())
      .default([]),
  })
  .strict()
  .superRefine((props, ctx) => {
    const ids = new Set<string>();
    const add = (value: string) => {
      if (ids.has(value))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate diagram ID: ${value}`,
        });
      ids.add(value);
    };
    props.nodes.forEach((n) => add(n.id));
    const nodes = new Set(props.nodes.map((n) => n.id));
    props.edges.forEach((e) => {
      add(e.id);
      if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to)
        ctx.addIssue({
          code: 'custom',
          message: 'Edges need distinct existing nodes',
        });
    });
    props.groups.forEach((g) => {
      add(g.id);
      if (
        new Set(g.nodeIds).size !== g.nodeIds.length ||
        g.nodeIds.some((n) => !nodes.has(n))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Group references must be unique existing nodes',
        });
    });
    if (props.activeNodeId && !nodes.has(props.activeNodeId))
      ctx.addIssue({ code: 'custom', message: 'Unknown active node' });
    if (
      props.activeEdgeId &&
      !props.edges.some((e) => e.id === props.activeEdgeId)
    )
      ctx.addIssue({ code: 'custom', message: 'Unknown active edge' });
  });
export const codePropsSchema = z
  .object({
    filename: label.default('example.ts'),
    language: z
      .enum(['typescript', 'javascript', 'json', 'python', 'bash', 'text'])
      .default('typescript'),
    code: z.string().max(12000),
    fontSize: z.number().min(10).max(32).default(20),
    highlightedLines: z.array(z.number().int().positive()).default([]),
    lineNumbers: z.boolean().default(true),
    focusRegion: z
      .object({
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const lines = p.code.split('\n').length;
    if (p.highlightedLines.some((n) => n > lines))
      ctx.addIssue({ code: 'custom', message: 'Highlight line outside code' });
    if (
      p.focusRegion &&
      (p.focusRegion.endLine < p.focusRegion.startLine ||
        p.focusRegion.endLine > lines)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid focus region' });
  });
export const terminalPropsSchema = z
  .object({
    title: label.default('Terminal'),
    entries: z
      .array(
        z
          .object({
            command: z.string().max(300),
            output: z.string().max(2000),
            status: z.enum(['neutral', 'success', 'error']).default('neutral'),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    fontSize: z.number().min(10).max(32).default(19),
    reveal: z.boolean().default(true),
  })
  .strict();
export const calloutPropsSchema = z
  .object({
    title: label,
    body: z.string().max(1200),
    tone: z.enum(['info', 'warning', 'success']).default('info'),
  })
  .strict();
export const metricPropsSchema = z
  .object({
    label,
    value: z.string().max(50),
    unit: z.string().max(30).default(''),
    detail: z.string().max(200).default(''),
  })
  .strict();
export const browserPropsSchema = z
  .object({
    url: label,
    title: label,
    heading: label,
    body: z.string().max(1200),
  })
  .strict();
export type DiagramProps = z.infer<typeof diagramPropsSchema>;
