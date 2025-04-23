import { HappenNode, NodeOptions } from './HappenNode';
import { HappenRuntimeModules } from './runtime-modules';

/**
 * Factory function to create a HappenNode instance with provided runtime modules.
 * This enforces that necessary modules are injected.
 */
export function createHappenContext(runtimeModules: HappenRuntimeModules) {
    /**
     * Returns a function that can create HappenNode instances within this context.
     * @param options Configuration options for the node.
     * @returns A new HappenNode instance.
     */
    return function createNode<S = any>(options: NodeOptions): HappenNode<S> {
        return HappenNode.create<S>(options, runtimeModules);
    };
} 