import { z } from 'zod';
export const editorialComponentTypeSchema = z.enum([
  'HeroText',
  'EditorialParagraph',
  'FloatingCard',
  'ChatCard',
  'ChartCard',
  'DiagramCard',
  'BrandOutro',
]);
const title = z.string().min(1).max(240);
const body = z.string().max(2400);
const emphasis = z.boolean().optional();
export const heroTextPropsSchema = z
  .object({
    eyebrow: title.optional(),
    title,
    body: body.optional(),
    align: z.enum(['left', 'center', 'right']).default('left'),
    emphasis,
  })
  .strict();
export const editorialParagraphPropsSchema = z
  .object({
    text: body,
    lead: title.optional(),
    align: z.enum(['left', 'center']).default('left'),
    emphasis,
  })
  .strict();
export const floatingCardPropsSchema = z
  .object({
    title,
    body,
    badge: title.optional(),
    emphasis,
    focused: z.boolean().optional(),
  })
  .strict();
export const chatCardPropsSchema = z
  .object({
    title: title.optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            text: z.string().min(1).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    emphasis,
  })
  .strict();
export const chartCardPropsSchema = z
  .object({
    title,
    points: z
      .array(z.object({ x: z.number(), y: z.number() }).strict())
      .min(2)
      .max(64),
    xLabel: title.optional(),
    yLabel: title.optional(),
    emphasis,
  })
  .strict();
export const diagramCardPropsSchema = z
  .object({
    title: title.optional(),
    nodes: z
      .array(
        z.object({ id: z.string().min(1).max(128), label: title }).strict(),
      )
      .min(2)
      .max(6),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128).optional(),
            from: z.string(),
            to: z.string(),
          })
          .strict(),
      )
      .max(12),
    activeNodeId: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set(p.nodes.map((n) => n.id));
    if (
      ids.size !== p.nodes.length ||
      p.edges.some((e) => !ids.has(e.from) || !ids.has(e.to)) ||
      (p.activeNodeId !== undefined && !ids.has(p.activeNodeId))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Diagram requires unique nodes and valid references',
      });
  });
export const brandOutroPropsSchema = z
  .object({ brand: title, tagline: body, mark: z.string().max(12).optional() })
  .strict();
