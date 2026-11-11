import { Button } from "@geld/hub-ui/components/button";
import { Spinner } from "@geld/hub-ui/components/spinner";
import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { AppMarkdown } from "#/components/markdown/app-markdown";
import {
	type AssistantAnswer,
	MAX_QUESTION_CHARS,
	questionProblem,
} from "#/lib/ai/assistant";
import { askPullAssistant } from "#/lib/github.functions";

const STARTERS = [
	"What does this change do?",
	"What should I look at first?",
	"What could this break?",
];

type Asked = { question: string; answer: AssistantAnswer };

/**
 * Questions about the pull request, answered by the reader's own AI provider.
 * Nothing is sent until the reader asks, and answers live only on this page.
 */
export function PullAssistantSection({
	owner,
	repo,
	pullNumber,
}: {
	owner: string;
	repo: string;
	pullNumber: number;
}) {
	const id = useId();
	const [question, setQuestion] = useState("");
	const [asked, setAsked] = useState<Asked | null>(null);
	const [busy, setBusy] = useState(false);
	const latest = useRef(0);

	const ask = async (text: string) => {
		if (busy || questionProblem(text) !== null) return;
		const run = ++latest.current;
		setBusy(true);
		let answer: AssistantAnswer;
		try {
			answer = await askPullAssistant({
				data: { owner, repo, pullNumber, question: text },
			});
		} catch {
			answer = { ok: false, error: "That did not go through. Try again." };
		}
		if (run !== latest.current) return;
		setAsked({ question: text.trim(), answer });
		setBusy(false);
		if (answer.ok) setQuestion("");
	};

	return (
		<section
			aria-label="Assistant"
			data-testid="pull-assistant"
			className="overflow-hidden rounded-lg bg-card shadow-card"
		>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-[0.5px] border-rule bg-group/60 px-4 py-3">
				<h3 className="text-sm font-medium text-foreground">Assistant</h3>
				<p className="text-xs text-muted-foreground">
					Uses your own AI provider. Sent only when you ask, never saved.
				</p>
			</div>

			<form
				className="flex flex-col gap-2.5 px-4 py-3"
				onSubmit={(event) => {
					event.preventDefault();
					void ask(question);
				}}
			>
				<label htmlFor={`${id}-question`} className="sr-only">
					Ask about this pull request
				</label>
				<textarea
					id={`${id}-question`}
					rows={2}
					value={question}
					maxLength={MAX_QUESTION_CHARS}
					placeholder="Ask about this pull request"
					onChange={(event) => setQuestion(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							void ask(question);
						}
					}}
					className="resize-none rounded-md border-[0.5px] border-border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus-visible:outline-1 focus-visible:outline-ring"
				/>
				<div className="flex flex-wrap items-center gap-1.5">
					{STARTERS.map((starter) => (
						<button
							key={starter}
							type="button"
							disabled={busy}
							onClick={() => {
								setQuestion(starter);
								void ask(starter);
							}}
							className="rounded-full border-[0.5px] border-rule px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
						>
							{starter}
						</button>
					))}
					<Button
						type="submit"
						size="sm"
						className="ml-auto"
						disabled={busy || question.trim() === ""}
					>
						{busy ? <Spinner size={12} /> : null}
						Ask
					</Button>
				</div>
			</form>

			{busy ? (
				<p
					role="status"
					className="border-t-[0.5px] border-rule px-4 py-3 text-[13px] text-muted-foreground"
				>
					Reading the pull request…
				</p>
			) : asked ? (
				<div
					className="flex flex-col gap-2 border-t-[0.5px] border-rule px-4 py-3"
					data-testid="pull-assistant-answer"
				>
					<p className="text-xs font-medium text-muted-foreground">
						{asked.question}
					</p>
					{asked.answer.ok ? (
						<>
							<AppMarkdown
								owner={owner}
								repo={repo}
								className="text-[13px] leading-5 text-foreground"
							>
								{asked.answer.text}
							</AppMarkdown>
							<p className="text-xs text-muted-foreground">
								{asked.answer.provider} · {asked.answer.model}
							</p>
						</>
					) : (
						<p role="alert" className="text-[13px] text-foreground">
							{asked.answer.error}{" "}
							{asked.answer.setup ? (
								<Link
									to="/settings/ai"
									className="underline underline-offset-2"
								>
									AI providers
								</Link>
							) : null}
						</p>
					)}
				</div>
			) : null}
		</section>
	);
}
