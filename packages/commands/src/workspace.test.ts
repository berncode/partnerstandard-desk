import { createMemoryWorkspace } from './testing';
import { describeWorkspaceContract } from './workspace.contract';

describeWorkspaceContract('memory', async (clock) => createMemoryWorkspace(() => clock.now));
