# Ethos Simulator Manager

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds simulator management commands to VS Code:

- **Ethos: Add Simulator** — set up a simulator firmware in the `simulator/` directory
- **Ethos: Set Simulator** — switch the active simulator firmware via a status bar quick pick

The extension is only activated in workspace containing a simulator/ directory.

Note: the simulator name come from Rob vscode-template, simulators/ or user defined name should be more appropriate.

The extension add a Status Bar with the active SIM version, clicking on it bring a choice selector. You can also Add a simulator from the list.
