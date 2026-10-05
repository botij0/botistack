# botistack

Adaptation of Cursor's pstack plugin made by Lauren Tan's to my own needs.

Compatible with OpenCode.

## Modifications depending on agents:

For the following skills we need to modify the text related to deploy agents, and just create the agents in Opencode folder with the corresponding behaviour and the model selected.

- `How` skill. We should create two opencode agents with the behaviour defined in the `references/` folder:
  - Explainer agent.
  - Explorer agent.
- `Why` skill. Same as `How` skill:
  - Epistemics don't need to be in a agent, is an extra context.
  - Investigator agent.
  - Synthetizer Agent.
  - Source-playbook needs to be adapted to the different sources we use (shorcut for example in Th, Google Docs...). Inside the folder `sources` paste code to handle each source playbook just like in the example.
- `Architext` modify the models. Review the concept of "stay in the loop"
  - The prompt for arena agents should be an agent.
- `Arena` modify the models. Review and adapt the `run_in_background: true` for opencode.
- `Swarm` modify the cloud agents for local agents.
- `Interrogate` modify the models for review
- `No Comments` need to define the subagent comment sicko.

Review the possible to add `Thermo-Nuclear Code Quality Review` cursor kit skill.
