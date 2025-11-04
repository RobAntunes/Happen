/**
 * happen-agents - Example wrapper for building agent-based systems
 *
 * This demonstrates how to build domain-specific wrappers on top of Happen.
 * This is NOT a core feature, but an example pattern for creating
 * specialized node types for specific use cases (like AI agents).
 *
 * The wrapper handles complexity (like LLM integration) while keeping
 * the interface pure Happen (nodes and events).
 */

/**
 * Create an agent node that can interact with LLMs
 * This is just an example - in production you'd integrate with real LLM APIs
 */
export function createAgentNode(config, createNodeFn) {
  const { name, llm, systemPrompt, tools = [] } = config;

  // Create a regular Happen node
  const node = createNodeFn(name);

  // Store agent-specific state
  const agentState = {
    conversationHistory: [],
    tools: new Map(tools.map(t => [t.name, t])),
    systemPrompt
  };

  // Register handler for agent task requests
  node.on('agent.task', async (event, context) => {
    try {
      const { task, context: taskContext = {} } = event.payload;

      // Add to conversation history
      agentState.conversationHistory.push({
        role: 'user',
        content: task
      });

      // Simulate LLM call (in production, call real LLM API)
      const response = await simulateLLMResponse({
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          ...agentState.conversationHistory
        ],
        tools: Array.from(agentState.tools.values()),
        context: taskContext
      });

      // Add response to history
      agentState.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      // Emit completion event
      await node.broadcast({
        type: 'agent.task.completed',
        payload: {
          task,
          response: response.content,
          toolCalls: response.toolCalls || [],
          agent: name
        },
        correlationId: event.context.causal.correlationId
      });

      return {
        success: true,
        response: response.content
      };
    } catch (error) {
      // Error handling through events
      await node.broadcast({
        type: 'agent.task.error',
        payload: {
          error: error.message,
          agent: name
        },
        correlationId: event.context.causal.correlationId
      });

      return {
        success: false,
        error: error.message
      };
    }
  });

  // Register handler for tool execution
  node.on('agent.execute-tool', async (event, context) => {
    const { toolName, parameters } = event.payload;
    const tool = agentState.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolName} not found`
      };
    }

    try {
      const result = await tool.execute(parameters);

      await node.broadcast({
        type: 'agent.tool.executed',
        payload: {
          tool: toolName,
          result,
          agent: name
        },
        correlationId: event.context.causal.correlationId
      });

      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Add helper methods (but still use events underneath)
  node.ask = async (question) => {
    return await node.broadcast({
      type: 'agent.task',
      payload: { task: question }
    });
  };

  return node;
}

/**
 * Create a context node that dynamically composes context for agents
 */
export function createContextNode(config, createNodeFn) {
  const { name, compose = {} } = config;

  const node = createNodeFn(name);

  // Register handler for context requests
  node.on('context.get', async (event, context) => {
    const { keys = Object.keys(compose) } = event.payload;

    const contextData = {};

    // Compose context from configured functions
    for (const key of keys) {
      if (compose[key]) {
        try {
          contextData[key] = await compose[key]();
        } catch (error) {
          contextData[key] = { error: error.message };
        }
      }
    }

    return {
      success: true,
      context: contextData,
      contextId: name
    };
  });

  return node;
}

/**
 * Simulate LLM response (in production, call real API)
 */
async function simulateLLMResponse({ messages, tools, context }) {
  // This is a mock - in production you'd call OpenAI, Anthropic, etc.
  const lastMessage = messages[messages.length - 1];

  // Simulate thinking time
  await new Promise(resolve => setTimeout(resolve, 100));

  // Simple response simulation
  return {
    content: `I understand you want to: "${lastMessage.content}". I would help you with that.`,
    toolCalls: []
  };
}

/**
 * Example usage
 */
export function exampleUsage(initializeHappen) {
  return async function() {
    const { createNode } = await initializeHappen();

    // Create an agent node
    const researcher = createAgentNode({
      name: 'research-agent',
      systemPrompt: 'You are a research assistant specializing in data analysis.',
      tools: [
        {
          name: 'search',
          description: 'Search for information',
          execute: async (params) => {
            return `Search results for: ${params.query}`;
          }
        }
      ]
    }, createNode);

    // Create a context node
    const contextNode = createContextNode({
      name: 'domain-context',
      compose: {
        expertise: () => ['data-analysis', 'statistics', 'visualization'],
        constraints: () => ({ maxTokens: 4000, style: 'professional' })
      }
    }, createNode);

    // Use the agent (still just regular Happen events)
    researcher.on('agent.task.completed', (event, context) => {
      console.log('[Agent Response]:', event.payload.response);
    });

    // Ask the agent to do something
    await researcher.broadcast({
      type: 'agent.task',
      payload: {
        task: 'Analyze competitor pricing strategies',
        context: { contextId: contextNode.getId() }
      }
    });

    console.log('Agent task submitted!');

    // The wrapper handles LLM integration, but the interface is pure Happen
    return { researcher, contextNode };
  };
}

/**
 * Building your own wrapper - template
 */
export function createMyWrapper(config, createNodeFn) {
  const node = createNodeFn(config.name);

  // Initialize any external dependencies
  const externalService = config.apiKey ? new SomeAPI(config.apiKey) : null;

  // Add specialized event handlers
  node.on('my-wrapper.action', async (event) => {
    try {
      // Do something with external service
      const result = externalService
        ? await externalService.process(event.payload)
        : { mock: true };

      // Emit results as events
      await node.broadcast({
        type: 'my-wrapper.complete',
        payload: result,
        correlationId: event.context.causal.correlationId
      });

      return { success: true, result };
    } catch (error) {
      // Error handling through events
      await node.broadcast({
        type: 'my-wrapper.error',
        payload: { error: error.message },
        correlationId: event.context.causal.correlationId
      });

      return { success: false, error: error.message };
    }
  });

  // Add helper methods if needed (but still emit events)
  node.customMethod = () => {
    node.broadcast({ type: 'my-wrapper.custom' });
  };

  return node;
}

// Mock API class for example
class SomeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async process(data) {
    return { processed: true, data };
  }
}
