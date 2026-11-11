import { Button } from "@geld/hub-ui/components/button";
import { Input } from "@geld/hub-ui/components/input";
import { Spinner } from "@geld/hub-ui/components/spinner";
import { Switch } from "@geld/hub-ui/components/switch";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
	type AiProviderView,
	isProviderKind,
	MAX_MODELS,
	PROVIDER_KIND_NAMES,
	PROVIDER_PRESETS,
	type ProviderKind,
	parseModels,
} from "#/lib/ai/providers";
import {
	getAiProviders,
	removeAiProviderFn,
	saveAiProviderFn,
} from "#/lib/ai/providers.functions";

export const Route = createFileRoute("/_protected/settings/ai")({
	loader: async () => getAiProviders(),
	component: AiProvidersPage,
});

type Draft = {
	id?: string;
	provider: ProviderKind;
	label: string;
	baseUrl: string;
	key: string;
	models: string;
	enabled: boolean;
};

const EMPTY: Draft = {
	provider: PROVIDER_PRESETS[0].kind,
	label: PROVIDER_PRESETS[0].label,
	baseUrl: PROVIDER_PRESETS[0].url,
	key: "",
	models: "",
	enabled: true,
};

function draftOf(provider: AiProviderView): Draft | null {
	if (!isProviderKind(provider.provider)) return null;
	return {
		id: provider.id,
		provider: provider.provider,
		label: provider.label,
		baseUrl: provider.baseUrl ?? "",
		key: "",
		models: provider.models.join("\n"),
		enabled: provider.enabled,
	};
}

function AiProvidersPage() {
	const { providers, canSave } = Route.useLoaderData();
	const router = useRouter();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const close = () => {
		setDraft(null);
		setError(null);
	};

	const save = async (next: Draft) => {
		setBusy(true);
		setError(null);
		try {
			const result = await saveAiProviderFn({
				data: {
					...(next.id ? { id: next.id } : {}),
					provider: next.provider,
					label: next.label,
					baseUrl: next.baseUrl.trim(),
					...(next.key ? { key: next.key } : {}),
					enabled: next.enabled,
					models: parseModels(next.models),
				},
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			close();
			await router.invalidate();
		} catch {
			setError("That did not save. Try again.");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (provider: AiProviderView) => {
		if (!window.confirm(`Remove ${provider.label}? Its key is deleted.`)) {
			return;
		}
		setBusy(true);
		try {
			await removeAiProviderFn({ data: provider.id });
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="flex flex-col gap-4" data-testid="ai-providers">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">AI providers</h2>
				<p className="text-sm text-muted-foreground">
					Bring your own key. Geld sends a pull request's text to a provider
					only when you ask it to, and only to the address you save here. Keys
					are stored sealed and never shown again.
				</p>
			</div>

			{canSave ? null : (
				<p role="status" className="text-sm text-muted-foreground">
					This Geld cannot store provider keys yet. Whoever runs it needs to set
					its encryption key.
				</p>
			)}

			<ul className="overflow-hidden rounded-xl border-[0.5px] border-border/70">
				{providers.length === 0 ? (
					<li className="px-4 py-6 text-center text-[13px] text-muted-foreground">
						No providers yet.
					</li>
				) : null}
				{providers.map((provider) => {
					const editing = draftOf(provider);
					return (
						<li
							key={provider.id}
							className="flex items-center gap-3 px-4 py-3 not-first:border-t-[0.5px] not-first:border-border/70"
						>
							<div className="min-w-0 flex-1">
								<p className="flex items-center gap-2 text-sm font-medium">
									<span className="truncate">{provider.label}</span>
									{provider.enabled ? null : (
										<span className="shrink-0 rounded-full border-[0.5px] border-dashed border-border px-1.5 text-xs font-normal text-muted-foreground">
											Off
										</span>
									)}
								</p>
								<p className="truncate text-xs text-muted-foreground">
									{[
										provider.baseUrl
											? new URL(provider.baseUrl).hostname
											: null,
										provider.models.length === 0
											? "No models listed"
											: provider.models.join(", "),
										provider.editable ? null : "Managed in the dashboard",
									]
										.filter((part) => part !== null)
										.join(" · ")}
								</p>
							</div>
							{provider.editable && editing ? (
								<>
									<Button
										variant="outline"
										size="sm"
										className="shrink-0"
										disabled={busy || !canSave}
										onClick={() => {
											setError(null);
											setDraft(editing);
										}}
									>
										Edit
										<span className="sr-only"> {provider.label}</span>
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="shrink-0"
										disabled={busy}
										onClick={() => remove(provider)}
									>
										Remove
										<span className="sr-only"> {provider.label}</span>
									</Button>
								</>
							) : null}
						</li>
					);
				})}
			</ul>

			{draft ? (
				<ProviderForm
					draft={draft}
					error={error}
					busy={busy}
					onChange={(next) => {
						setDraft(next);
						setError(null);
					}}
					onCancel={close}
					onSave={save}
				/>
			) : (
				<div>
					<Button
						variant="outline"
						size="sm"
						disabled={!canSave || busy}
						onClick={() => {
							setError(null);
							setDraft(EMPTY);
						}}
					>
						Add a provider
					</Button>
				</div>
			)}
		</section>
	);
}

function ProviderForm({
	draft,
	error,
	busy,
	onChange,
	onCancel,
	onSave,
}: {
	draft: Draft;
	error: string | null;
	busy: boolean;
	onChange: (draft: Draft) => void;
	onCancel: () => void;
	onSave: (draft: Draft) => void;
}) {
	const ids = useId();
	const editing = draft.id !== undefined;
	const field =
		"flex flex-col gap-1.5 text-[13px] font-medium text-foreground";
	return (
		<form
			data-testid="ai-provider-form"
			className="flex flex-col gap-4 rounded-xl border-[0.5px] border-border/70 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSave(draft);
			}}
		>
			<h3 className="text-sm font-semibold">
				{editing ? `Edit ${draft.label}` : "Add a provider"}
			</h3>

			{editing ? null : (
				<div className="flex flex-wrap gap-1.5">
					{PROVIDER_PRESETS.map((preset) => (
						<button
							key={preset.url}
							type="button"
							aria-pressed={draft.baseUrl === preset.url}
							onClick={() =>
								onChange({
									...draft,
									provider: preset.kind,
									label: preset.label,
									baseUrl: preset.url,
								})
							}
							className="rounded-md border-[0.5px] border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-surface-1 aria-pressed:text-foreground"
						>
							{preset.label}
						</button>
					))}
				</div>
			)}

			<label className={field} htmlFor={`${ids}-label`}>
				Name
				<Input
					id={`${ids}-label`}
					value={draft.label}
					maxLength={100}
					onChange={(event) => onChange({ ...draft, label: event.target.value })}
				/>
			</label>

			<label className={field} htmlFor={`${ids}-url`}>
				Address
				<Input
					id={`${ids}-url`}
					value={draft.baseUrl}
					inputMode="url"
					spellCheck={false}
					onChange={(event) =>
						onChange({ ...draft, baseUrl: event.target.value })
					}
				/>
				<span className="text-xs font-normal text-muted-foreground">
					{PROVIDER_KIND_NAMES[draft.provider]}. Only https, and only a provider
					this Geld allows.
				</span>
			</label>

			<label className={field} htmlFor={`${ids}-key`}>
				API key
				<Input
					id={`${ids}-key`}
					type="password"
					autoComplete="off"
					value={draft.key}
					placeholder={editing ? "Leave empty to keep the saved key" : ""}
					onChange={(event) => onChange({ ...draft, key: event.target.value })}
				/>
			</label>

			<label className={field} htmlFor={`${ids}-models`}>
				Models
				<textarea
					id={`${ids}-models`}
					rows={3}
					spellCheck={false}
					value={draft.models}
					onChange={(event) =>
						onChange({ ...draft, models: event.target.value })
					}
					className="rounded-md border-[0.5px] border-border bg-transparent px-2.5 py-1.5 font-mono text-[13px] font-normal outline-none focus-visible:outline-1 focus-visible:outline-ring"
				/>
				<span className="text-xs font-normal text-muted-foreground">
					One id per line, the one to try first on top. Up to {MAX_MODELS}.
				</span>
			</label>

			<label className="flex items-center gap-2 text-[13px] font-medium">
				<Switch
					checked={draft.enabled}
					onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
				/>
				Use this provider
			</label>

			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}

			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={busy}>
					{busy ? <Spinner size={12} /> : null}
					{editing ? "Save" : "Add provider"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
