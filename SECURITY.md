# Security Policy

## 🛡️ Supported Versions

We actively support the following versions of Happen with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | ✅ Active support  |
| < 1.0   | ❌ Not supported   |

## 🚨 Reporting Security Vulnerabilities

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities responsibly by following these steps:

### 1. Email Report
Send an email to: **security@happen-framework.org**

Include the following information:
- **Subject**: `[SECURITY] Brief description of the vulnerability`
- **Description**: Detailed description of the vulnerability
- **Steps to reproduce**: How to reproduce the issue
- **Impact**: What could an attacker potentially do?
- **Proposed fix**: If you have suggestions for fixing it

### 2. What to Expect
- **Acknowledgment**: We'll acknowledge receipt within 24 hours
- **Initial Assessment**: We'll provide an initial assessment within 72 hours
- **Regular Updates**: We'll keep you informed about our progress
- **Resolution**: We'll work with you to resolve the issue responsibly

### 3. Coordinated Disclosure
- We'll work together to determine an appropriate timeline for disclosure
- We'll credit you for the discovery (unless you prefer to remain anonymous)
- We'll coordinate the release of security patches before public disclosure

## 🔒 Security Considerations in Happen

### Event Integrity
Happen provides built-in security features for event integrity:

```typescript
// Events include cryptographic hashes and signatures
const event = createEvent('sensitive.operation', payload, {
  integrity: {
    hash: 'sha256-hash-of-canonical-event',
    signature: 'cryptographic-signature',
    publicKey: 'signing-public-key'
  }
});
```

### Node Identity & Authentication
```typescript
// Nodes can be configured with identity verification
const secureNode = happen.createNode('secure-service', {
  acceptFrom: ['trusted-node-*'], // Only accept from trusted nodes
  accept: (origin) => verifyNodeIdentity(origin.nodeId)
});
```

### Input Validation
Always validate event payloads in your handlers:

```typescript
node.on('user.action', (event, context) => {
  // Validate input before processing
  const { userId, action } = validatePayload(event.payload);
  
  if (!isAuthorized(userId, action)) {
    return createErrorEvent('unauthorized');
  }
  
  // Safe to proceed
  return processAction;
});
```

## 🛡️ Security Best Practices

### 1. Input Validation
```typescript
// Always validate and sanitize event payloads
function validateCreateUser(payload: unknown): CreateUserPayload {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    role: z.enum(['user', 'admin'])
  });
  
  return schema.parse(payload);
}
```

### 2. Authentication & Authorization
```typescript
// Implement proper auth checks
node.on('admin.action', (event, context) => {
  const { userId, permissions } = event.context.user || {};
  
  if (!permissions?.includes('admin')) {
    return createErrorEvent('forbidden', { userId });
  }
  
  return processAdminAction;
});
```

### 3. Secrets Management
```typescript
// Never log or transmit secrets
node.on('payment.process', (event, context) => {
  const { cardNumber, ...safePayload } = event.payload;
  
  // Log only safe data
  console.log('Processing payment:', safePayload);
  
  // Process securely
  return processPaymentSecurely(cardNumber);
});
```

### 4. Rate Limiting
```typescript
// Implement rate limiting for sensitive operations
const rateLimiter = new Map();

node.on('api.request', (event, context) => {
  const clientId = event.context.origin?.sourceId;
  
  if (isRateLimited(rateLimiter, clientId)) {
    return createErrorEvent('rate_limited');
  }
  
  return processRequest;
});
```

### 5. Error Handling
```typescript
// Don't leak sensitive information in errors
node.on('database.query', (event, context) => {
  try {
    return executeQuery(event.payload);
  } catch (error) {
    // Log full error internally
    console.error('Database error:', error);
    
    // Return safe error to client
    return createErrorEvent('database_error', {
      message: 'An error occurred processing your request',
      requestId: generateRequestId()
    });
  }
});
```

## 🔍 Security Checklist for Contributors

When contributing to Happen, please consider:

### Code Review Security Checklist
- [ ] **Input Validation**: All external inputs are validated
- [ ] **Authentication**: Proper auth checks are in place
- [ ] **Authorization**: Users can only access what they should
- [ ] **Error Handling**: Errors don't leak sensitive information
- [ ] **Logging**: Sensitive data is not logged
- [ ] **Dependencies**: No known vulnerable dependencies added
- [ ] **Secrets**: No hardcoded secrets or credentials
- [ ] **Rate Limiting**: Protection against abuse is considered

### Testing Security
- [ ] Test with malicious inputs
- [ ] Verify error handling doesn't leak information
- [ ] Test authentication and authorization paths
- [ ] Verify input validation works correctly

## 🚨 Known Security Considerations

### 1. Transport Security
- NATS connections should use TLS in production
- Configure proper authentication for NATS servers
- Use secure WebSocket connections (WSS) in browsers

### 2. Event Validation
- Always validate event payloads before processing
- Be cautious with dynamic event types or handlers
- Implement proper access controls for event patterns

### 3. State Management
- Protect sensitive data in node state
- Consider encryption for sensitive state data
- Implement proper access controls for cross-node state access

## 📞 Contact Information

For security-related questions or concerns:
- **Email**: security@happen-framework.org
- **Response Time**: Within 24 hours for initial contact
- **Languages**: English

## 🏆 Security Hall of Fame

We thank the following security researchers for responsibly disclosing vulnerabilities:

*None reported yet - be the first!*

---

**Remember**: Security is everyone's responsibility. When in doubt, report it!