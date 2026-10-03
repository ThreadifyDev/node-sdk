Feature: __CONTRACT_NAME__
Version: 1
Description: Exercise browser-side contract decisions.

Step: "browser_checkout"
  Description: "The browser begins a checkout."
  Optional context: "source" means "Where the checkout started."

Step: "browser_complete"
  Description: "The browser completes the checkout."

Rule: Begin checkout
  When step "browser_checkout" is submitted
  Then owner must be "browser_sample"
  And this step is an entry point
  And next step must be one of "browser_complete"

Rule: Complete checkout
  When step "browser_complete" is submitted
  Then owner must be "browser_sample"
  And step "browser_checkout" must have succeeded
  And this step is terminal
