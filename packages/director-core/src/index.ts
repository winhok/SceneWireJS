import { z } from 'zod';
export interface EngineProfile {
  id: string;
  rendererId: string;
  aiDescription: string;
  strengths: readonly string[];
  avoidWhen: readonly string[];
  traits: readonly string[];
  relativeCost: 'lowest' | 'low' | 'medium' | 'high';
  editability: 'structured' | 'parameterized-code' | 'freeform-code';
  determinism: 'strict' | 'same-environment' | 'best-effort';
  scaffoldId?: string;
  /** Runtime requirements; authoring also requires direct imports below. */
  dependencies?: readonly string[];
  authoringDependencies?: readonly string[];
  /** Validated third-party compatibility ranges; owned packages bind the CLI version. */
  authoringDependencyRanges?: Readonly<Record<string, string>>;
  requiresGpu?: boolean;
  guidance?: string;
  fallbackEngineId?: string;
}
export interface AuthoringDependencyDiagnostic {
  id: string;
  status: 'missing' | 'unresolvable' | 'incompatible' | 'complete';
  declared?: string;
  installed?: string;
  required?: string;
}
export interface EngineEnvironment {
  rendererIds: readonly string[];
  dependencyIds: readonly string[];
  authoringDependencyIds?: readonly string[];
  authoringDiagnostics?: Readonly<
    Record<string, AuthoringDependencyDiagnostic>
  >;
}
export interface EngineCandidate extends EngineProfile {
  availability: 'defined' | 'available' | 'unavailable';
  unavailableReasons: readonly string[];
  authoringAvailability: 'defined' | 'complete' | 'incomplete';
  missingAuthoringDependencies: readonly string[];
  authoringDiagnostics?: readonly AuthoringDependencyDiagnostic[];
}
/** Footage requirements are fulfilled by the host media compositor, not a graphics engine. */
export const requiresExistingFootage = (requirements: readonly string[]) =>
  requirements.some(
    (r) => r === 'existing-footage' || r === 'existing footage',
  );
const graphicsRequirements = (requirements: readonly string[]) =>
  requirements.filter(
    (r) => r !== 'existing-footage' && r !== 'existing footage',
  );
export class EngineRegistry {
  private profiles = new Map<string, EngineProfile>();
  constructor(private environment?: EngineEnvironment) {}
  register(profile: EngineProfile): void {
    if (
      !profile.id.trim() ||
      !profile.rendererId.trim() ||
      this.profiles.has(profile.id)
    )
      throw new Error(`Duplicate or invalid engine: ${profile.id}`);
    this.profiles.set(profile.id, structuredClone(profile));
  }
  getEngine(id: string): EngineCandidate | undefined {
    const profile = this.profiles.get(id);
    if (!profile) return undefined;
    const reasons = this.environment
      ? [
          ...(!this.environment.rendererIds.includes(profile.rendererId)
            ? [`Missing renderer: ${profile.rendererId}`]
            : []),
          ...(profile.dependencies ?? [])
            .filter((id) => !this.environment!.dependencyIds.includes(id))
            .map((id) => `Missing dependency: ${id}`),
        ]
      : [];
    const missing =
      this.environment?.authoringDependencyIds === undefined
        ? []
        : (profile.authoringDependencies ?? []).filter(
            (id) => !this.environment!.authoringDependencyIds!.includes(id),
          );
    const diagnostics = (profile.authoringDependencies ?? []).flatMap((id) =>
      this.environment?.authoringDiagnostics?.[id]
        ? [this.environment.authoringDiagnostics[id]!]
        : [],
    );
    return {
      ...structuredClone(profile),
      ...(diagnostics.length
        ? { authoringDiagnostics: structuredClone(diagnostics) }
        : {}),
      authoringAvailability:
        this.environment?.authoringDependencyIds === undefined
          ? 'defined'
          : missing.length
            ? 'incomplete'
            : 'complete',
      missingAuthoringDependencies: missing,
      availability: !this.environment
        ? 'defined'
        : reasons.length
          ? 'unavailable'
          : 'available',
      unavailableReasons: reasons,
    };
  }
  listEngines(): EngineCandidate[] {
    return [...this.profiles.keys()].map((id) => this.getEngine(id)!);
  }
  hasMediaProvider(): boolean {
    return this.environment?.rendererIds.includes('web') ?? false;
  }
  findCompatibleEngines(requirements: readonly string[]): EngineCandidate[] {
    if (requiresExistingFootage(requirements) && !this.hasMediaProvider())
      return [];
    const costs = { lowest: 0, low: 1, medium: 2, high: 3 };
    return this.listEngines()
      .filter(
        (engine) =>
          engine.availability === 'available' &&
          graphicsRequirements(requirements).every((r) =>
            engine.traits.includes(r),
          ),
      )
      .sort((a, b) => costs[a.relativeCost] - costs[b.relativeCost]);
  }
}
const text = z.string().trim().min(1).max(8000);
export const visualDirectionSchema = z
  .object({
    palette: z.record(z.string().min(1), z.string().regex(/^#[\da-fA-F]{6}$/)),
    typography: z
      .object({ family: text, titleWeight: z.number().int().min(100).max(900) })
      .strict(),
    radius: z.number().nonnegative(),
    spacing: z.number().positive(),
    motion: text,
    density: text.optional(),
    lighting: text.optional(),
    brandLanguage: text.optional(),
  })
  .strict();
export type VisualDirection = z.infer<typeof visualDirectionSchema>;
export const visualScenePlanSchema = z
  .object({
    id: text,
    sceneId: text.optional(),
    narrativeIntent: text,
    visualIntent: text,
    requirements: z.array(text).max(64),
    engineId: text,
    rationale: text,
    fallbackEngineId: text.optional(),
    editableParameters: z.array(text).optional(),
    references: z.array(z.object({ description: text }).strict()).optional(),
  })
  .strict();
export const visualPlanSchema = z
  .object({
    version: z.literal(1),
    id: text,
    brief: text,
    direction: visualDirectionSchema.optional(),
    scenes: z.array(visualScenePlanSchema).min(1).max(1000),
  })
  .strict();
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export interface PlanDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  sceneId?: string;
  message: string;
}
export function validateVisualPlan(
  input: unknown,
  registry: EngineRegistry,
  sceneIds?: readonly string[],
) {
  const parsed = visualPlanSchema.safeParse(input);
  const diagnostics: PlanDiagnostic[] = [];
  if (!parsed.success)
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((i) => ({
        severity: 'error' as const,
        code: 'plan.schema',
        message: `${i.path.join('.')}: ${i.message}`,
      })),
    };
  const ids = new Set<string>();
  for (const scene of parsed.data.scenes) {
    const error = (code: string, message: string) =>
      diagnostics.push({ severity: 'error', code, sceneId: scene.id, message });
    if (ids.has(scene.id)) error('plan.duplicate', 'Duplicate plan scene ID');
    ids.add(scene.id);
    if (scene.sceneId && sceneIds && !sceneIds.includes(scene.sceneId))
      error('plan.scene', `Unknown project scene: ${scene.sceneId}`);
    if (scene.sceneId && !sceneIds)
      error(
        'plan.scene-context',
        'Supply project scene IDs to validate sceneId',
      );
    if (
      requiresExistingFootage(scene.requirements) &&
      !registry.hasMediaProvider()
    )
      error(
        'plan.media-provider',
        'Existing footage requires the browser/Web host media provider',
      );
    const engine = registry.getEngine(scene.engineId);
    if (!engine) error('plan.engine', `Unknown engine: ${scene.engineId}`);
    else {
      if (engine.availability !== 'available')
        error(
          'plan.availability',
          `${engine.id}: ${engine.availability}; ${engine.unavailableReasons.join('; ')}`,
        );
      for (const requirement of graphicsRequirements(scene.requirements))
        if (!engine.traits.includes(requirement))
          error(
            'plan.compatibility',
            `${engine.id} does not declare ${requirement}`,
          );
    }
    if (scene.fallbackEngineId) {
      const fallback = registry.getEngine(scene.fallbackEngineId);
      if (!fallback || fallback.availability !== 'available')
        error('plan.fallback', 'Fallback engine unknown or unavailable');
      else if (
        !graphicsRequirements(scene.requirements).every((r) =>
          fallback.traits.includes(r),
        )
      )
        error(
          'plan.fallback-compatibility',
          'Fallback cannot preserve declared requirements; explicit revised plan required',
        );
      if (scene.fallbackEngineId === scene.engineId)
        error('plan.fallback-self', 'Fallback must differ');
    }
  }
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    plan: parsed.data,
  };
}
export const builtinEngines: readonly EngineProfile[] = [
  {
    id: 'structured',
    rendererId: 'canvas',
    aiDescription:
      'Highest semantic editability and lowest runtime complexity. Prefer when existing SceneWire components express the idea well.',
    strengths: [
      'technical diagrams',
      'science components',
      'charts',
      'semantic cards',
      'structured text',
      'precise later editing',
      'voice choreography',
    ],
    avoidWhen: [
      'novel visual language',
      'complex CSS composition',
      'GPU particle field',
      'true 3D',
      'one-off brand art direction',
    ],
    traits: ['2d', 'diagram', 'semantic-editing', 'text', 'cards', 'chart'],
    relativeCost: 'lowest',
    editability: 'structured',
    determinism: 'strict',
  },
  {
    id: 'web-dom',
    rendererId: 'web',
    aiDescription:
      'HTML/CSS/SVG and seek-controlled WAAPI for naturally composed layouts.',
    strengths: [
      'typography',
      'SaaS UI',
      'brand graphics',
      'glass',
      'layout',
      'masks',
      'CSS effects',
      'SVG illustration',
    ],
    avoidWhen: ['large moving object counts', 'true 3D'],
    traits: ['2d', 'text', 'ui', 'vector', 'masks', 'brand'],
    relativeCost: 'low',
    editability: 'parameterized-code',
    determinism: 'same-environment',
    scaffoldId: 'web-dom',
    authoringDependencies: ['@scenewirejs/web-runtime'],
  },
  {
    id: 'web-react',
    rendererId: 'web',
    aiDescription:
      'Choose only when component/state structure materially improves composition.',
    strengths: [
      'nested UI',
      'repeated structures',
      'parameterized product UI',
      'state-heavy compositions',
    ],
    avoidWhen: ['simple hero typography', 'small one-off scene'],
    traits: ['2d', 'text', 'ui', 'vector', 'masks', 'brand', 'component-state'],
    relativeCost: 'low',
    editability: 'parameterized-code',
    determinism: 'same-environment',
    scaffoldId: 'web-react',
    dependencies: ['react', 'react-dom'],
    authoringDependencies: ['react', 'react-dom', '@scenewirejs/web-runtime'],
    authoringDependencyRanges: { react: '^19.3.0', 'react-dom': '^19.3.0' },
  },
  {
    id: 'web-pixi',
    requiresGpu: true,
    rendererId: 'web',
    aiDescription:
      'GPU 2D for large moving object counts; no true 3D overhead.',
    strengths: [
      'particles',
      'data fields',
      'glow',
      'filters',
      'masks',
      'sprites',
      '2.5D',
    ],
    avoidWhen: ['simple cards', 'true 3D'],
    traits: [
      '2d',
      '2.5d',
      'particles',
      'gpu-2d',
      'filters',
      'masks',
      'sprites',
    ],
    relativeCost: 'medium',
    editability: 'parameterized-code',
    determinism: 'same-environment',
    scaffoldId: 'web-pixi',
    dependencies: ['pixi.js'],
    authoringDependencies: ['pixi.js', '@scenewirejs/web-runtime'],
    authoringDependencyRanges: { 'pixi.js': '^8.21.0' },
    guidance: 'docs/engine-authoring.md#web-pixi',
  },
  {
    id: 'web-three',
    requiresGpu: true,
    rendererId: 'web',
    aiDescription:
      'Use only where true perspective, depth, camera and materials add value.',
    strengths: [
      'true 3D',
      'product spins',
      '3D diagrams',
      'camera orbit',
      'lighting',
      'materials',
      'GLTF',
    ],
    avoidWhen: ['simple card animation', 'flat UI', '2D particles'],
    traits: ['3d', 'camera', 'materials', 'lighting', 'depth', 'particles'],
    relativeCost: 'high',
    editability: 'parameterized-code',
    determinism: 'same-environment',
    scaffoldId: 'web-three',
    dependencies: ['three'],
    authoringDependencies: ['three', '@scenewirejs/web-runtime'],
    authoringDependencyRanges: { three: '^0.186.1' },
    guidance: 'docs/engine-authoring.md#web-three',
  },
];
export function createEngineRegistry(environment?: EngineEnvironment) {
  const registry = new EngineRegistry(environment);
  builtinEngines.forEach((p) => registry.register(p));
  return registry;
}
