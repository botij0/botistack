# botistack

Adaptation of Cursor's pstack plugin made by Lauren Tan's to my own needs.

Compatible with OpenCode.

## Modifications depending on agents:

For the following skills we need to modify the text related to deploy agents, and just create the agents in Opencode folder with the corresponding behaviour and the model selected.

- `How` skill. We should create two opencode agents with the behaviour defined in the `references/` folder:
  - Explainer agent.
  - Explorer agent.
- `Why` skill. Same as `How` skill:
  - Source-playbook needs to be adapted to the different sources we use (shorcut for example in Th, Google Docs...)
