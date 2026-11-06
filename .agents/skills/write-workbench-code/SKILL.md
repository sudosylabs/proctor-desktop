---
name: write-workbench-code
description: Write or review Proctor Desktop renderer TypeScript in VS Code's style - window views, panes, parts, design-system controls, workbench services, contributions, and their DOM, listeners and lifecycle. Use whenever you create or substantially edit a class or file under src/prctr/workbench, src/prctr/base/browser/ui, or src/prctr/platform/*/browser, and when reviewing such a change.
---

# Write workbench code

Code here should read like the matching VS Code subsystem: classes that own
state, injected services, small named methods, DOM built in one visible tree,
and one statement per line. `develop-workbench` decides *what* a window,
contribution or item owns; this skill decides *how the code is written*.

## 1. Pick the reference before writing

Read the closest upstream class first and keep it open while you write:

| Writing | Read upstream |
|---|---|
| a part, view or pane | `vs/workbench/browser/parts/views/viewPane.ts`, `vs/workbench/browser/part.ts` |
| a control | `vs/base/browser/ui/button/button.ts`, `vs/base/browser/ui/inputbox/inputBox.ts` |
| a collection | `vs/base/browser/ui/list/listWidget.ts` |
| a service | any `vs/workbench/services/<area>/common/<area>.ts` and its `browser/` implementation |
| startup work | `vs/workbench/common/contributions.ts` |

Ported copies of these live under `src/prctr/` at the same relative paths; use
`adapt-vscode` before copying more.

The in-repo reference is the LaunchWindow under
`src/prctr/workbench/browser/launch/`, including its pure presentation model. New renderer code should read like it:

- `launchWindow.ts`: the window's composition root. `bootstrapLaunchWindow`
  builds a `ServiceCollection` and `InstantiationService`, and the `LaunchWindow`
  class creates its views with `createInstance`, owns focus and announcements,
  and renders one view model.
- `launchIdentityService.ts`: a `createDecorator` service wrapping a preload
  client, with events for changes and one-at-a-time intents.
- `readinessChecklist.ts`, `serverSummary.ts`, `launchStatus.ts`,
  `launchActions.ts`: views that build their DOM once and update it in `render`.
- `launchPresentation.ts`: every state as a table entry, tested in Node without
  a DOM.

Other Proctor-authored renderer code is **not** precedent. Known debt to avoid
copying:

- `WorkbenchBootstrapContext.getService<T>('string-id')`: an untyped service
  locator. New code takes typed services in its constructor.
- `base/browser/ui/button/buttonControl.ts`, `field/textField.ts` and the other
  `*Control.ts` files: several statements per line. Use their behavior, not their
  layout.

The step is complete when you can name the upstream class your code mirrors.

## 2. Lay out the feature

```
src/prctr/workbench/contrib/<feature>/browser/
  <feature>.contribution.ts   registers the feature: items, actions, contributions
  <feature>View.ts            the view or pane class
  <feature>View.css           its styles, imported by <feature>View.ts
  <feature>Messages.ts        defineMessage descriptors for its text
src/prctr/workbench/services/<area>/common/<area>.ts            interface + createDecorator
src/prctr/workbench/services/<area>/browser/<area>Service.ts    implementation
```

A feature never imports another feature's views. It reaches others through a
service, a registry, a command or a context key. `source-code-organization` owns
layer and runtime-folder placement.

The step is complete when each file has one of these roles.

## 3. Write a view as a class

The service below is illustrative; the shape is what matters.

```ts
export class ServerSummary extends Disposable {
	readonly element: HTMLElement;

	private readonly title: HTMLElement;
	private readonly address: HTMLElement;
	private readonly change: ButtonControl;

	constructor(
		host: HTMLElement,                                   // plain arguments first
		private readonly localization: LocalizationContext,
		@ILaunchIdentityService private readonly identity: ILaunchIdentityService, // then services
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.title = $('h2.prctr-server-summary__title');
		this.address = $('p.prctr-server-summary__address');
		this.element = $('section.prctr-server-summary', {}, this.title, this.address);
		host.append(this.element);

		this.change = this._register(new ButtonControl(this.element, {
			variant: 'secondary',
			label: this.localization.format(messages.changeServer),
		}));

		this.registerListeners();
		this.render(this.identity.projection);
	}

	private registerListeners(): void {
		this._register(this.change.onDidRequest(() => {
			void this.identity.changeServer();
		}));
		this._register(this.identity.onDidChange(projection => {
			this.render(projection);
		}));
	}

	private render(projection: LaunchIdentityProjection): void {
		this.title.textContent = projection.institutionName ?? projection.origin ?? '';
		this.address.textContent = projection.origin ?? '';
	}
}
```

- **DOM.** Build the whole tree once, near the top of the constructor, with
  `h()`/`$()`/`append()` from `base/browser/dom.ts`, or
  `createElementFactory(document)` when the class is handed a host or document.
  Later code changes text, attributes and `hidden`; it does not rebuild the tree.
  `src/prctr/AGENTS.md` lists the lint rules that enforce this.
- **Controls.** Use the design-system controls in `base/browser/ui`
  (`ButtonControl`, `TextFieldControl`, `ToggleControl`, `MenuControl`,
  `ProgressControl`) for single controls, and the ported VS Code widgets (`List`,
  `ActionBar`, `DomScrollableElement`) for collections, toolbars and scrolling.
  Never hand-build a button, field or list that one of these already provides.
- **Text.** Every visible or announced string comes from a `defineMessage`
  descriptor in the feature's messages file, formatted through
  `LocalizationContext`.
- **Children.** A child that needs services is created with
  `instantiationService.createInstance(Child, ...args)`, never `new` with
  services passed by hand. A child with no services may use `new`.
- **Ownership.** Register every listener, child, emitter and timer with
  `this._register` as you create it. After an `await`, check `this._store.isDisposed`
  before touching DOM or state, and drop a late result whose revision or id is
  no longer current.
- **Shape.** The constructor builds and wires; `registerListeners()` subscribes;
  `render()`/`update()` writes state into the DOM. Split again when a method no
  longer fits on one screen.

The step is complete when the view's state, DOM and listeners all belong to one
class and nothing outlives `dispose()`.

## 4. Write services and contributions

- **Service contract:** `export const IAreaService = createDecorator<IAreaService>('areaService');`
  beside the interface in `common/<area>.ts`. Events report changes
  (`onDidChange...`); methods perform actions.
- **Implementation:** a class in `browser/<area>Service.ts` whose constructor takes
  `@I...` services, registered with
  `registerSingleton(IAreaService, AreaService, InstantiationType.Delayed)`.
- **Renderer boundary:** a renderer service never touches Electron or the preload
  directly. It wraps the capability-specific client the preload exposes, and
  validates what comes back (`develop-identity-and-exam-security` owns the IPC
  rules).
- **Bridge from the current kernel:** windows still bootstrap through
  `WorkbenchBootstrapContext`. Keep any `getService('...')` call inside the
  contribution's `activate()`, convert it to a typed value there, and pass that
  into constructors. When a window is rebuilt, give its composition root a
  `ServiceCollection` and `InstantiationService`
  (`platform/instantiation/common/`) and register its services there.

The step is complete when every dependency of a class appears, typed, in its
constructor.

## 5. Write it to be read

- One statement per line. Braces on every `if`/`for`/`while` body that is not a
  single short `return`/`throw`/`continue`.
- No `;`-joined statements, comma-chained side effects, or one-line handlers that
  do several things. Give a multi-step handler a named private method.
- Prefer a class with named methods over closures that capture shared mutable
  state.
- Narrow untrusted input with a validator, not `as`.
- Names say what something is (`serverTitle`, not `el2`); booleans read as
  questions (`isReady`, `hasNotice`).
- Comments explain a non-obvious *why* or invariant in plain words. They never
  restate the code or cite docs, skills or tickets.
- Keep the repository formatter's output; do not hand-reflow ported upstream
  files.

The step is complete when a reviewer can follow each method top to bottom
without scrolling sideways or re-reading a line.

## 6. Review bar

Answer each of these, in the change description or review, before calling it
done:

1. Which upstream class did you compare with, and where does this differ on
   purpose?
2. Who owns each piece of state, and which service is the authority for it?
3. Which service boundary or process does the code cross?
4. Where is it registered, and how is it disposed?
5. Which control or widget renders each interactive element?
6. Where does each user-visible string come from?
7. How do keyboard, focus, screen reader, zoom, high contrast and reduced motion
   behave? (`develop-accessible-ui` owns the detail.)

A change that cannot answer one of these is not finished.
