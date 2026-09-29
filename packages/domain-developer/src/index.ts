import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import typescript from '@shikijs/langs/typescript';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import python from '@shikijs/langs/python';
import bash from '@shikijs/langs/bash';
import githubDark from '@shikijs/themes/github-dark';
import {
  clipSchema,
  componentClipSchema,
  componentPropsSchema,
  type Clip,
} from '@scenewirejs/schema';
import {
  createComponentRegistry,
  type ComponentDefinition,
} from '@scenewirejs/runtime';
import { compileDiagram } from './diagrams';
import { createCodeCompiler, compileTerminal, compileBrowser } from './windows';
import { box, text } from './primitives';
export type DeveloperType =
  import('@scenewirejs/schema').DeveloperComponentType;
const nodes = (names: string[], kinds: string[] = []) =>
  names.map((label, index) => ({
    id: `node-${index}`,
    label,
    kind: kinds[index] ?? 'service',
  }));
const chain = (count: number) =>
  Array.from({ length: count - 1 }, (_, i) => ({
    id: `edge-${i}`,
    from: `node-${i}`,
    to: `node-${i + 1}`,
  }));
const definitions = [
  {
    type: 'CodeWindow',
    label: 'Code window',
    description: 'Syntax-colored code with focused lines.',
    width: 760,
    height: 360,
    props: {
      filename: 'tool.ts',
      language: 'typescript',
      code: 'const result = await tools.invoke({\n  name: "get_order",\n  arguments: { id: "order-42" }\n});',
      highlightedLines: [2, 3],
      lineNumbers: true,
    },
  },
  {
    type: 'Terminal',
    label: 'Terminal',
    description: 'Deterministic command and output reveal.',
    width: 700,
    height: 320,
    props: {
      title: 'Terminal',
      entries: [
        { command: 'pnpm test', output: '12 tests passed', status: 'success' },
      ],
      reveal: true,
    },
  },
  {
    type: 'FlowDiagram',
    label: 'Flow diagram',
    description: 'Typed nodes, edges and step reveal.',
    width: 1060,
    height: 240,
    props: {
      nodes: nodes(['Request', 'Validate', 'Execute', 'Respond']),
      edges: chain(4),
      direction: 'horizontal',
      stepReveal: true,
    },
  },
  {
    type: 'ArchitectureDiagram',
    label: 'Architecture',
    description: 'Services, APIs, databases, queues and groups.',
    width: 1060,
    height: 300,
    props: {
      nodes: nodes(
        ['Client', 'API', 'Service', 'Database'],
        ['client', 'api', 'service', 'database'],
      ),
      edges: chain(4),
      direction: 'horizontal',
      groups: [
        {
          id: 'boundary',
          label: 'Business boundary',
          nodeIds: ['node-1', 'node-2', 'node-3'],
        },
      ],
    },
  },
  {
    type: 'RAGPipeline',
    label: 'RAG pipeline',
    description: 'Retrieval pipeline with active node.',
    width: 1100,
    height: 240,
    props: {
      nodes: nodes(
        ['Question', 'Embedding', 'Vector DB', 'Retriever', 'Reranker', 'LLM'],
        ['client', 'service', 'database', 'service', 'service', 'llm'],
      ),
      edges: chain(6),
      activeNodeId: 'node-3',
      stepReveal: true,
    },
  },
  {
    type: 'AgentGraph',
    label: 'Agent graph',
    description: 'Agent, tool, MCP, memory, LLM and human nodes.',
    width: 1060,
    height: 280,
    props: {
      nodes: nodes(
        ['Human', 'Agent', 'MCP server', 'Tool', 'Memory', 'LLM'],
        ['human', 'agent', 'mcp', 'tool', 'memory', 'llm'],
      ),
      edges: [
        ...chain(4),
        { id: 'memory-edge', from: 'node-1', to: 'node-4' },
        { id: 'llm-edge', from: 'node-1', to: 'node-5' },
      ],
    },
  },
  {
    type: 'Callout',
    label: 'Callout',
    description: 'An explanatory note with semantic tone.',
    width: 760,
    height: 170,
    props: {
      title: 'Keep a controlled boundary',
      body: 'Tools enforce permissions, business semantics and audit.\nRAG retrieves indexed knowledge.',
      tone: 'info',
    },
  },
  {
    type: 'MetricCard',
    label: 'Metric card',
    description: 'Latency, cost, tokens or accuracy.',
    width: 380,
    height: 200,
    props: {
      label: 'Retrieval latency',
      value: '142',
      unit: 'ms',
      detail: 'Measured at the retrieval boundary',
    },
  },
  {
    type: 'BrowserFrame',
    label: 'Browser frame',
    description: 'An editable product mock viewport.',
    width: 760,
    height: 320,
    props: {
      url: 'https://example.com/orders',
      title: 'Order console',
      heading: 'An explicit business action',
      body: 'Status: read-only\nAccess checked by the business service.',
    },
  },
] as const;
export const developerComponents = definitions.map((definition) =>
  Object.freeze({
    ...definition,
    schema: componentClipSchema(definition.type),
    aiDescription: definition.description,
  }),
);
export function createDeveloperClip(
  type: DeveloperType,
  id: string,
  startFrame: number,
  durationFrames: number,
): Clip {
  const component = developerComponents.find((c) => c.type === type)!;
  const hasReveal =
    type === 'Terminal' || type === 'FlowDiagram' || type === 'RAGPipeline';
  return clipSchema.parse({
    id,
    component: type,
    startFrame,
    durationFrames,
    transform: {
      x: 80,
      y: 280,
      width: component.width,
      height: component.height,
      zIndex: 5,
    },
    props: component.props,
    animations:
      hasReveal && durationFrames > 1
        ? [
            {
              property: 'progress',
              keyframes: [
                { frame: 0, value: 0 },
                {
                  frame: Math.min(durationFrames - 1, 90),
                  value: 1,
                  easing: 'linear',
                },
              ],
            },
          ]
        : [],
  });
}
export function createDeveloperRegistry(): readonly ComponentDefinition[] {
  // Per-registry state: explicit ownership, no hidden singleton; tokens are never recomputed per frame.
  const highlighter = createHighlighterCoreSync({
    themes: [githubDark],
    langs: [typescript, javascript, json, python, bash],
    engine: createJavaScriptRegexEngine(),
  });
  const code = createCodeCompiler(highlighter);
  const compile = (clip: Clip) => {
    switch (clip.component) {
      case 'CodeWindow':
        return code(clip);
      case 'Terminal':
        return compileTerminal(clip);
      case 'BrowserFrame':
        return compileBrowser(clip);
      case 'FlowDiagram':
      case 'ArchitectureDiagram':
      case 'RAGPipeline':
      case 'AgentGraph':
        return compileDiagram(clip, clip.props);
      case 'Callout': {
        const p = clip.props,
          w = clip.transform.width,
          h = clip.transform.height;
        const accent =
          p.tone === 'warning'
            ? '#f4c674'
            : p.tone === 'success'
              ? '#53d5b0'
              : '#82b9f4';
        return [
          box(`${clip.id}:box`, 0, 0, w, h, '#17283c', accent),
          text(`${clip.id}:title`, p.title, 24, 22, w - 48, 24, accent),
          text(
            `${clip.id}:body`,
            p.body,
            24,
            64,
            w - 48,
            18,
            '#aec0d6',
            h - 80,
          ),
        ];
      }
      case 'MetricCard': {
        const p = clip.props,
          w = clip.transform.width,
          h = clip.transform.height;
        return [
          box(`${clip.id}:box`, 0, 0, w, h),
          text(`${clip.id}:label`, p.label, 24, 22, w - 48, 18, '#849fbd'),
          text(
            `${clip.id}:value`,
            `${p.value} ${p.unit}`,
            24,
            64,
            w - 48,
            44,
            '#53d5b0',
          ),
          text(
            `${clip.id}:detail`,
            p.detail,
            24,
            h - 44,
            w - 48,
            14,
            '#8ca6c2',
          ),
        ];
      }
      default:
        throw new Error(`Not a developer component: ${clip.component}`);
    }
  };
  return createComponentRegistry(
    developerComponents.map((c) => ({
      type: c.type,
      authoring: {
        label: c.label,
        description: c.description,
        defaultWidth: c.width,
        defaultHeight: c.height,
        defaultDurationFrames: 150,
      },
      compile,
      ...(c.type.endsWith('Diagram') ||
      c.type === 'RAGPipeline' ||
      c.type === 'AgentGraph'
        ? {
            choreography: {
              apply(action, target) {
                if (action === 'highlight' && target.kind === 'node')
                  return { propsPatch: { activeNodeId: target.nodeId } };
                if (
                  (action === 'highlight' || action === 'connect') &&
                  target.kind === 'edge'
                )
                  return {
                    propsPatch: { activeEdgeId: target.edgeId },
                    ...(action === 'connect'
                      ? {
                          animation: {
                            primitiveId: `${target.clipId}:${target.edgeId}`,
                            property: 'progress' as const,
                            from: 0,
                            to: 1,
                          },
                        }
                      : {}),
                  };
                throw new Error(
                  `Unsupported diagram choreography: ${action}/${target.kind}`,
                );
              },
            },
          }
        : {}),
      schema: componentPropsSchema(c.type),
      defaultProps: componentPropsSchema(c.type).parse(c.props),
      aiDescription: c.aiDescription,
      category: 'developer',
      semanticCapabilities:
        c.type.endsWith('Diagram') ||
        c.type === 'RAGPipeline' ||
        c.type === 'AgentGraph'
          ? ['nodes', 'edges', 'relationships']
          : ['content'],
      motionCapabilities: [
        'show',
        'highlight',
        ...(c.type === 'Terminal' ||
        c.type === 'FlowDiagram' ||
        c.type === 'RAGPipeline'
          ? ['reveal']
          : []),
      ],
    })),
  );
}
