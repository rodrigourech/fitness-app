import type { ReactNode } from 'react'
import AppBar from '../components/AppBar'

const SOURCES = {
  acsm: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
  load: 'https://pubmed.ncbi.nlm.nih.gov/33433148/',
  progression: 'https://pubmed.ncbi.nlm.nih.gov/36199287/',
  effort: 'https://pubmed.ncbi.nlm.nih.gov/38393985/',
  rest: 'https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full',
}

/** Explains the active recommendation rules and the evidence behind the training approach. */
export default function InfoPage({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg">
          Back
        </button>
      </AppBar>

      <header className="mb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent-ink">Training guide</p>
        <h1 className="text-2xl font-semibold tracking-tight">How recommendations work</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Understand the workout hints, what research supports, and where your own judgement matters.
        </p>
      </header>

      <nav aria-label="Training guide topics" className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ['app-rules', 'Workout hints'],
          ['rep-ranges', 'Rep ranges'],
          ['effort', 'Effort & rest'],
          ['comparisons', 'Comparing progress'],
          ['evidence', 'Research'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-zinc-200/70 px-3 py-2 font-medium hover:bg-accent-soft dark:bg-zinc-800">
            {label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        <GuideSection id="app-rules" title="What the app checks today" label="App rule">
          <p>
            <strong className="text-zinc-900 dark:text-zinc-100">Increase weight</strong> appears when every recorded work set
            in the previous finished workout of the same template and exercise variant reaches the target reps, with the
            same number of work sets as planned. There is no effort score to enter.
          </p>
          <p>
            Exercise settings default to a target of 10 and minimum of 7. Variants inherit these settings unless you
            override them. “Min reps” and “Target” in the workout editor override the exercise settings; clear an override
            to inherit. If work sets have different targets, the highest target and minimum apply to the exercise.
            For one-sided exercises, both sides must reach the target. Settings are copied when a workout starts.
          </p>
          <div className="rounded-lg bg-accent-soft p-3 text-accent-ink">
            <p className="font-semibold">Example: target 10 reps</p>
            <p>10 / 10 / 10 → Increase weight</p>
            <p>10 / 9 / 8 → Keep weight</p>
            <p>First set 6 reps in two comparable workouts, minimum 7 → Reduce weight</p>
          </div>
          <p>
            Choose the next weight yourself; hints give no kg amount and never change your weights automatically.
            “Keep weight” means build reps towards the target. Without a previous performance in the same workout,
            no recommendation is shown.
          </p>
          <p>
            “Reduce weight” appears only if the first work set is below minimum in the two latest finished workouts of
            the same template and variant. Both workouts must contain the planned number of work sets, use one identical
            positive weight throughout, and have the same recorded rest setting. A weight change or a missing performance
            prevents this warning. For one-sided exercises, the weaker side is used; both sides must be recorded.
          </p>
          <p>
            Skipped exercises and warm-ups do not count. The Warm Up switch displays a reminder; it does not add a logged
            set. Home and Stats list increase-ready exercises separately for each active workout. Rep counts cannot tell
            the app whether your form, actual rest, effort or recovery were appropriate: review those before reducing weight.
          </p>
        </GuideSection>

        <GuideSection id="rep-ranges" title="Is 7 reps too few?" label="Evidence & interpretation">
          <p>
            There is no established biological cutoff at 8 reps. Research finds muscle growth across a broad range of loads;
            heavier loads tend to benefit maximal strength more. A review of 28 studies found no statistically significant
            differences in muscle growth between load categories, but those studies trained to failure. That does not prove
            every rep range is equivalent in every training situation. <Source href={SOURCES.load}>Lopez et al., 2021</Source>
          </p>
          <p>
            A range such as 7–10 reps can be a practical way to build back towards 10 after increasing weight. Seven is a
            programming choice, not a scientifically proven superior minimum. An exact “two sessions below minimum”
            reduction rule is also a practical heuristic, not a validated formula.
          </p>
          <p>
            Reaching 10 / 9 / 8 / 7 at the same weight can be a reason to keep the weight and build reps. One weaker last
            set alone does not establish that the weight is too heavy. Repeated difficulty in the first work set is a
            stronger reason to review the load, rest and recovery. This is the reasoning behind the app’s conservative warning.
          </p>
        </GuideSection>

        <GuideSection id="effort" title="Clean reps, effort and rest" label="Practical guidance">
          <p>
            Keep technique and range of motion consistent. A useful approach is to finish with about 1–2 more clean reps
            possible. In an eight-week study of trained participants, stopping at 1–2 RIR (repetitions in reserve) produced similar quadriceps
            growth to training to failure, with less acute fatigue. This finding does not establish one optimal effort
            level for every muscle or exercise. <Source href={SOURCES.effort}>Refalo et al., 2024</Source>
          </p>
          <p>
            Later sets can lose reps as fatigue builds. Before reducing weight because of a weak final set, check whether
            your rest was sufficient and comparable to last time. A meta-analysis suggests a small muscle-growth advantage
            for rest periods longer than 60 seconds over shorter rests, with substantial variation and uncertainty.
            There is no universal best rest time. <Source href={SOURCES.rest}>Singer et al., 2024</Source>
          </p>
        </GuideSection>

        <GuideSection id="comparisons" title="Read progress in context" label="Practical guidance">
          <p>
            Adding reps at the same weight is progress too. A study of 43 trained participants found broadly similar
            adaptations over eight weeks when progression came from more reps or more weight. This supports both
            approaches, without validating the app’s exact increase rule. <Source href={SOURCES.progression}>Plotkin et al., 2022</Source>
          </p>
          <p>
            Compare the same exercise variant, workout, weight, number of work sets, technique and rest. For example,
            10 / 9 / 8 gives 27 total reps; 10 / 10 / 8 gives 28. That extra rep is a useful improvement under comparable
            conditions. Fewer reps after a weight increase do not necessarily mean you have lost strength.
          </p>
          <p>
            “Completed reps” counts only checked work sets. One-sided exercises sum the left and right sides.
            The previous total is from the same template and variant. A difference is shown after all work sets are
            checked, only when set count and weights match and all reps are entered; otherwise the app explains what changed.
          </p>
          <p>
            Training volume is work-set weight × reps; one-sided sets count both sides and warm-ups are excluded.
            Estimated 1RM uses the Epley formula: weight × (1 + reps / 30), using the weaker side when both sides are
            recorded. These numbers help track trends; neither is a direct measure of muscle growth or a tested maximum.
          </p>
        </GuideSection>

        <GuideSection id="evidence" title="What research can tell us" label="Evidence summary">
          <p>
            The 2026 ACSM position stand synthesised 137 systematic reviews. It supports progressive resistance training,
            highlights heavier loads for maximal strength and higher training volumes for muscle growth, and does not
            establish one exact repetition threshold for everyone. <Source href={SOURCES.acsm}>ACSM, 2026</Source>
          </p>
          <p>
            The research supports the overall approach. The app’s specific thresholds translate that approach into simple
            hints; they are not personalised measurements or proof that a weight change is necessary.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Evidence reviewed 12 October 2026. This page is available offline; opening the original studies requires an internet connection.
          </p>
        </GuideSection>
      </div>

      <button onClick={onDone} className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg">
        Back to app
      </button>
    </main>
  )
}

function GuideSection({ id, title, label, children }: { id: string; title: string; label: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="card scroll-mt-4 p-4">
      <p className="mb-1 text-xs font-semibold text-accent-ink">{label}</p>
      <h2 id={`${id}-heading`} className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-ink underline underline-offset-2">
      {children}
    </a>
  )
}
