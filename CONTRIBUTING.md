# Contributing to Happen

First off, thank you for considering contributing to Happen! It's people like you that make Happen such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps which reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include code samples and stack traces if applicable**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain which behavior you expected to see instead**
- **Explain why this enhancement would be useful**

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Follow the TypeScript styleguide
- Include thoughtfully-worded, well-structured tests
- Document new code
- End all files with a newline

## Development Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

### Setup Development Environment

```bash
# Clone your fork
git clone https://github.com/yourusername/happen.git
cd happen

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Check types
npm run typecheck

# Lint code
npm run lint

# Format code
npm run format
```

### Project Structure

```
happen/
├── src/           # Source code
├── tests/         # Test files
├── examples/      # Example applications
├── docs/          # Documentation
└── scripts/       # Build and utility scripts
```

### Testing

- Write tests for all new functionality
- Maintain test coverage above 90%
- Use descriptive test names
- Follow the AAA pattern (Arrange, Act, Assert)

Example test:

```typescript
describe('Node', () => {
  it('should emit events to registered handlers', () => {
    // Arrange
    const node = happen.node('test');
    const handler = jest.fn();
    
    // Act
    node.on('test.event', handler);
    node.emit({ type: 'test.event', payload: { data: 'test' } });
    
    // Assert
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'test.event',
        payload: { data: 'test' }
      })
    );
  });
});
```

### Code Style

- Use TypeScript for all code
- Follow the existing code style
- Use meaningful variable names
- Write self-documenting code
- Add comments only when necessary
- Keep functions small and focused

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### Documentation

- Update README.md with details of changes to the interface
- Update the docs/ folder with any new functionality
- Write JSDoc comments for all public APIs
- Include examples in documentation

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a pull request with these changes
4. After merge, create a GitHub release
5. npm publish will run automatically via GitHub Actions

## Questions?

Feel free to open an issue with your question or reach out on our Discord server.

Thank you for contributing! 🎉