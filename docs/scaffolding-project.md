# Project scaffolding

## Overview

The extension provides a command to scaffold new projects from GitHub template repositories. This allows you to quickly create new projects with a predefined structure and boilerplate code.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac).
2. Search for and select the command `Ethos: Scaffold New Project`.
3. Follow the prompts to choose a destination folder, select a template, and answer any questions related to the template.
4. The extension will generate the project files based on your selections and inputs.

## Templates

The available templates are defined in the `templates.json` file. Each template includes a name, description, and a link to the GitHub repository that serves as the template source.
To add a new template, simply raise an issue on the project's GitHub repository. It is always possible to use an url to a GitHub repository that is not listed in the templates, but adding it to the list makes it more discoverable and easier to use for others.

## Template Documentation

- The repository hosting the template must be public and contain a valid `.scaffold.json` file at its root. This file defines the questions to ask the user. Then a very simple templating syntax is used to generate the files based on the user's answers.

```json
{
    "name": "Ethos Lua Widget",
    "description": "Basic widget template with RSSI telemetry set",
    "version": 1,
    "prompts": [
      {
        "id": "appPath",
        "type": "input",
        "message": "App folder ? (e.g., myapp or src/myapp)",
        "default": "myapp",
        "validate": "^[\\w-]*(/[\\w-]+)?$"
      }
    ],
    "templateFilePatterns": ["**/*.lua", "**/*.json", "**/*.md","**/*.mjs"],
    "excludePatterns": [".scaffold.json", ".git/**", "**/.gitignore", "**/.gitkeep"]
}
```

templateFilePatterns are passed through a simple templating engine, where you can use `${{variableName}}` to insert the value of a variable. The variables are defined by the prompts (the id field) and their value is the answer provided by the user.

You can put those variables anywhere in the file content, or in the file name. For example, you could have a file named `${{appPath}}/main.lua` and it would be generated as `myapp/main.lua` if the user answers `myapp` to the prompt.

You can also access configuration values using `${{config.extension.someConfigKey}}`. This allows you to use values from the extension's configuration in your templates. Finally you pass pass an optional filter to the variable, like `${{appPath | upper}}` to transform the value before inserting it. The available filters are `uppercase`, `lowercase`, `kebabcase`, and `basename`.

Refer to the [basic widget template](https://github.com/flyingeek/ethos-devtools-scaffold-basic) for a complete example of a template repository.
