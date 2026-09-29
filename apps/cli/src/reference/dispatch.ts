import { MediaError } from '@scenewirejs/media-inspect';
import { referenceCheck } from './reference';
import { mediaCommand } from './media';
import { initCommand } from './reference';
import { compareCommand } from './compare';
export async function referenceCommand(command: string, args: string[]) {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    if (command === 'reference-check') {
      const [file, ...rest] = args;
      if (!file)
        throw new MediaError('reference.arguments', 'Spec file required');
      return await referenceCheck(file, rest, controller.signal);
    }
    const [sub, file, ...rest] = args;
    if (!file)
      throw new MediaError('reference.arguments', 'Local input file required');
    if (command === 'media')
      return await mediaCommand(sub, file, rest, controller.signal);
    if (command !== 'reference')
      throw new MediaError('reference.command', 'Unknown reference command');
    if (sub === 'init') return await initCommand(file, rest, controller.signal);
    if (sub !== 'compare')
      throw new MediaError('reference.command', 'Unknown reference command');
    return await compareCommand(file, rest, controller.signal);
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
