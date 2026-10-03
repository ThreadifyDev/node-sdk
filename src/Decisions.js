const CAN_QUERY = `
  query Can($threadId: ID!, $action: String, $goal: String, $context: JSON) {
    can(threadId: $threadId, action: $action, goal: $goal, context: $context) {
      threadId stepName allowed status matchedBy requiredSteps
      satisfiedSteps missingSteps previousStep reason
    }
  }
`;

const SHOULD_QUERY = `
  query Should($threadId: ID!, $action: String, $goal: String) {
    should(threadId: $threadId, action: $action, goal: $goal) {
      threadId stepName eligible recommendation reason
    }
  }
`;

const NEXT_QUERY = `
  query Next($threadId: ID!) {
    next(threadId: $threadId) {
      threadId paths { actions status reason }
    }
  }
`;

function decisionCandidate(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Provide an action or goal');
  }
  const { action, goal } = options;
  if ((typeof action !== 'string' && action !== undefined) ||
      (typeof goal !== 'string' && goal !== undefined) ||
      Boolean(action?.trim()) === Boolean(goal?.trim())) {
    throw new TypeError('Provide exactly one non-empty action or goal');
  }
  if (goal && goal.length > 4096) throw new TypeError('Goal must be at most 4096 characters');
  return { action: action?.trim() || null, goal: goal?.trim() || null };
}

export { CAN_QUERY, SHOULD_QUERY, NEXT_QUERY, decisionCandidate };
