# Contributing to Happen

Thank you for your interest in contributing to Happen! As a framework built on the philosophy of radical simplicity, we value contributions that maintain this principle while extending the framework's capabilities.

## Core Philosophy

Before contributing, please familiarize yourself with Happen's core philosophy:

- **Radical Simplicity**: True power emerges from simplicity rather than complexity
- **Pure Causality**: Events form natural causal chains that define system behavior
- **Decentralized Intelligence**: Smart systems emerge from simple nodes making local decisions
- **Composable Primitives**: Complex behaviors emerge from simple, understandable parts
- **Runtime Transparency**: Direct access to the underlying runtime environments

Our goal is to maintain a framework with minimal primitives that compose to create powerful capabilities. We believe the most elegant solutions often emerge not from adding complexity, but from discovering the right minimal abstractions.

## How to Contribute

### Reporting Issues

When reporting issues, please include:

1. A clear description of the problem
2. Steps to reproduce the issue
3. Expected vs. actual behavior
4. Version information (Happen version, runtime environment, OS)
5. Minimal code example that demonstrates the issue

### Feature Requests

We welcome feature requests that align with Happen's philosophy. When suggesting features:

1. Describe the problem you're trying to solve before proposing a solution
2. Explain how the feature aligns with Happen's philosophy of radical simplicity
3. Consider whether the feature could be implemented as a composable extension rather than a core addition
4. If possible, include examples of how the feature would be used

### Pull Requests

When submitting pull requests:

1. Create a branch with a descriptive name (e.g., `feature/event-replay` or `fix/node-discovery`)
2. Include tests for new functionality
3. Ensure all tests pass
4. Update documentation to reflect changes
5. Keep PRs focused on a single concern
6. Follow the existing code style and patterns

## Development Setup

1. Fork and clone the repository
```bash
git clone https://github.com/YOUR-USERNAME/happen.git
cd happen
```

2. Install dependencies
```bash
npm install
```

3. Run tests
```bash
npm test
```

## Coding Guidelines

### Simplicity First

- Before adding code, ask: "Is this the simplest possible solution?"
- Prefer fewer, well-designed primitives over many specialized ones
- Follow the principle of "Do One Thing Well"

### Event-Driven Design

- Maintain the event-driven nature of the framework
- Ensure causality is preserved in all operations
- Keep nodes focused on single responsibilities

### API Design

- APIs should be intuitive and consistent with existing patterns
- Prefer composable functions over complex objects
- Maintain backward compatibility when possible

### Testing

- Write unit tests for all new functionality
- Include integration tests for complex interactions
- Test across different runtime environments when applicable

## Documentation

Documentation is crucial for a framework like Happen. When adding or changing features:

1. Update the relevant documentation files
2. Include clear, concise examples
3. Explain not just how to use a feature, but why and when to use it
4. Ensure code examples are tested and working

## Review Process

All contributions go through a review process:

1. Automated checks (linting, tests)
2. Code review by maintainers
3. Possible revisions based on feedback
4. Final approval and merge

## Community Guidelines

We strive to maintain a welcoming and inclusive community:

- Be respectful and considerate in all interactions
- Focus on the ideas being discussed, not the person presenting them
- Assume good intentions from other contributors
- Help others learn and grow through constructive feedback

## Recognition

All contributors are valued and will be recognized in our documentation and release notes. Significant contributors may be invited to join as maintainers.

## Questions?

If you have questions about contributing, please [open an issue](https://github.com/happen-framework/happen/issues/new) with the label "question".

Thank you for helping make Happen better while embracing the philosophy of radical simplicity!