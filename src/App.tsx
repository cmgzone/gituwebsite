import { useState } from 'react'
import SiteHeader from './components/SiteHeader'
import ParticleWordmark from './components/ParticleWordmark'

type FoundationSection = {
  id: string
  index: string
  title: string
  copy: string
}

const foundationSections: readonly FoundationSection[] = [
  {
    id: 'product',
    index: '01',
    title: 'Responsibility, not autocomplete.',
    copy: 'Gitu reads the system before it changes it—requirements, architecture, callers, constraints, and the evidence that will prove the work.',
  },
  {
    id: 'capabilities',
    index: '02',
    title: 'One agent. The whole execution loop.',
    copy: 'Understand, plan, delegate, implement, test, inspect, repair, and verify. Each capability exists to move real software work toward a durable outcome.',
  },
  {
    id: 'how-it-works',
    index: '03',
    title: 'An observable path from goal to proof.',
    copy: 'Every task advances through explicit requirements, bounded changes, live checks, and a final verification record instead of disappearing into a chat transcript.',
  },
  {
    id: 'benchmarks',
    index: '04',
    title: 'Measure what survives verification.',
    copy: 'Evaluation states are reported as PASS, PARTIAL, or UNDER TEST. Gitu does not manufacture percentages to make unfinished work look complete.',
  },
  {
    id: 'why-gitu',
    index: '05',
    title: 'Less babysitting. More completed work.',
    copy: 'Traditional assistants stop at a suggestion. Gitu keeps ownership through implementation, inspection, repair, and evidence-backed completion.',
  },
  {
    id: 'docs',
    index: '06',
    title: 'Designed to be understood.',
    copy: 'Architecture, execution behavior, provider boundaries, and verification workflows belong in the open where developers can inspect how the agent operates.',
  },
  {
    id: 'open-source',
    index: '07',
    title: "Don't trust the landing page. Inspect the code.",
    copy: 'Gitu is built around observable execution, explicit requirements, and verifiable outcomes. Repository links will use confirmed project metadata only.',
  },
  {
    id: 'download',
    index: '08',
    title: 'Give Gitu a goal. Let it handle the work.',
    copy: 'Your code. Your provider. Your workflow.',
  },
]

function App() {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle')
  const apiExample = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.gitu.ai/v1",
  apiKey: process.env.GITU_API_KEY,
});

const response = await client.chat.completions.create({
  model: "gitu/coder",
  messages: [
    {
      role: "user",
      content: "Build a responsive dashboard"
    }
  ]
});`

  const handleCopyApiExample = async () => {
    try {
      await navigator.clipboard.writeText(apiExample)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('unavailable')
    }
  }

  return (
    <div className="site-frame">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main-content" data-page="gitu-marketing">
        <section className="foundation-hero" id="top" aria-labelledby="hero-title">
          <div className="hero-background-label" aria-hidden="true">
            <span>AGENT</span>
            <span>GITU</span>
            <span>AGENT</span>
            <span>GITU</span>
            <span>AGENT</span>
            <span>GITU</span>
            <span>AGENT</span>
            <span>GITU</span>
          </div>

          <div className="foundation-hero__inner shell">
            <div className="foundation-hero__copy">
              <p className="eyebrow">Autonomous engineering, built for real codebases</p>
              <h1 id="hero-title">
                Ship software.
                <span>Not prompts.</span>
              </h1>
              <p className="foundation-hero__lede">
                Gitu understands your codebase, plans the work, delegates when necessary,
                executes changes, verifies its own results, and keeps working until the job
                is actually done.
              </p>
              <div className="hero-actions" aria-label="Get started with Gitu">
                <a className="hero-action hero-action--primary" href="#download">
                  <span>Download Gitu</span>
                  <span aria-hidden="true">↗</span>
                </a>
                <a className="hero-action hero-action--secondary" href="#open-source">
                  <span>View on GitHub</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>

            <div className="foundation-signal" aria-label="AGENT GITU autonomous execution signal" data-signal-state="autonomous-execution" data-signal-phase="proof" data-signal-identity="agent-gitu">
              <div className="foundation-signal__rail">
                <span>goal.accepted</span>
                <span>scope.mapped</span>
                <span>work.executing</span>
                <span>proof.pending</span>
              </div>
              <div className="foundation-signal__core">
                <ParticleWordmark />
              </div>
              <p>AGENT / READY / 01</p>
            </div>
          </div>
        </section>

        <div className="narrative" aria-label="Gitu product narrative">
          {foundationSections.map((section) => (
            <section
              className="foundation-section"
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              key={section.id}
            >
              <div className="foundation-section__inner shell">
                <p className="foundation-section__index" aria-hidden="true">
                  {section.index}
                </p>
                <div>
                  <h2 id={`${section.id}-title`}>{section.title}</h2>
                  <p>{section.copy}</p>
                </div>
                <span className="foundation-section__status" aria-hidden="true">
                  Section mapped
                </span>
              </div>
            </section>
          ))}
        </div>

        <section className="models-platform" id="models" aria-labelledby="models-title">
          <div className="models-platform__inner shell">
            <div className="models-platform__heading">
              <p className="eyebrow">Gitu Models / Developer preview</p>
              <h2 id="models-title">One API. Powerful AI models. Built for agents.</h2>
              <p>
                Gitu Models is a planned inference platform for coding and reasoning work. Developers
                will be able to reach future hosted models through one Gitu-compatible API—while Gitu
                Agent continues to own the autonomous development loop.
              </p>
            </div>

            <div className="agent-models-bridge" aria-label="Two connected Gitu products">
              <div>
                <span>01</span>
                <strong>Gitu Agent</strong>
                <p>AI coding and autonomous development.</p>
              </div>
              <span className="agent-models-bridge__plus" aria-hidden="true">+</span>
              <div>
                <span>02</span>
                <strong>Gitu Models</strong>
                <p>Future inference API for developers.</p>
              </div>
            </div>

            <div className="models-platform__grid">
              <div className="api-flow" aria-label="Planned Gitu Models request flow">
                <div className="api-flow__header">
                  <span>PLANNED REQUEST PATH</span>
                  <i aria-hidden="true" />
                </div>
                <ol>
                  <li><span>01</span><strong>Your app</strong><small>Any OpenAI-style client</small></li>
                  <li><span>02</span><strong>Gitu API</strong><small>https://api.gitu.ai/v1</small></li>
                  <li><span>03</span><strong>Smart routing</strong><small>Built for coding and reasoning</small></li>
                  <li><span>04</span><strong>Open model families</strong><small>Qwen / GLM / DeepSeek / more planned</small></li>
                </ol>
                <p className="api-flow__note">Model families shown as planned routing options, not live availability.</p>
              </div>

              <div className="api-code" id="models-api">
                <div className="api-code__header">
                  <div><span className="api-code__dot" aria-hidden="true" /><span>openai-compatible.ts</span></div>
                  <button type="button" onClick={handleCopyApiExample} aria-describedby="copy-status">
                    {copyStatus === 'copied' ? 'Copied' : 'Copy code'}
                  </button>
                </div>
                <pre aria-label="OpenAI-compatible API preview"><code><span className="code-keyword">import</span> <span className="code-type">OpenAI</span> <span className="code-keyword">from</span> <span className="code-string">&quot;openai&quot;</span>;<br />
<br />
<span className="code-keyword">const</span> <span className="code-variable">client</span> = <span className="code-keyword">new</span> <span className="code-type">OpenAI</span>(&#123;<br />
  <span className="code-property">baseURL</span>: <span className="code-string">&quot;https://api.gitu.ai/v1&quot;</span>,<br />
  <span className="code-property">apiKey</span>: <span className="code-variable">process</span>.<span className="code-property">env</span>.<span className="code-variable">GITU_API_KEY</span>,<br />
&#125;);<br />
<br />
<span className="code-keyword">const</span> <span className="code-variable">response</span> = <span className="code-keyword">await</span> <span className="code-variable">client</span>.<span className="code-property">chat</span>.<span className="code-property">completions</span>.<span className="code-property">create</span>(&#123;<br />
  <span className="code-property">model</span>: <span className="code-string">&quot;gitu/coder&quot;</span>,<br />
  <span className="code-property">messages</span>: [&#123; <span className="code-property">role</span>: <span className="code-string">&quot;user&quot;</span>, <span className="code-property">content</span>: <span className="code-string">&quot;Build a responsive dashboard&quot;</span> &#125;],<br />
&#125;);</code></pre>
                <p id="copy-status" className="api-code__status" aria-live="polite">
                  {copyStatus === 'copied' ? 'API preview copied to your clipboard.' : copyStatus === 'unavailable' ? 'Clipboard access is unavailable in this browser.' : 'Developer preview — endpoint and model availability are coming soon.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="models-catalog shell" id="models-preview" aria-labelledby="models-preview-title">
          <div className="section-kicker"><span>MODEL PREVIEW</span><p>Availability is planned, not live.</p></div>
          <h2 id="models-preview-title">A focused model surface for real development work.</h2>
          <div className="models-table-wrap">
            <table>
              <thead><tr><th>Model</th><th>Best for</th><th>Context</th><th>Input</th><th>Output</th><th>Status</th></tr></thead>
              <tbody>
                <tr><th scope="row">Gitu Coder</th><td>Coding + agents</td><td>—</td><td>—</td><td>—</td><td><span className="model-status">Coming soon</span></td></tr>
                <tr><th scope="row">Gitu Reasoner</th><td>Planning + reasoning</td><td>—</td><td>—</td><td>—</td><td><span className="model-status">Coming soon</span></td></tr>
                <tr><th scope="row">Open Models</th><td>Qwen / GLM / DeepSeek family</td><td>—</td><td>—</td><td>—</td><td><span className="model-status model-status--planned">Planned</span></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="models-compatibility" aria-labelledby="compatibility-title">
          <div className="models-compatibility__inner shell">
            <div>
              <p className="eyebrow">OpenAI compatibility / planned</p>
              <h2 id="compatibility-title">Switch without rewriting your application.</h2>
              <p>
                Gitu intends to support an OpenAI-compatible API so a future migration stays deliberately
                small. Change the connection, choose a Gitu model, and keep the rest of your application familiar.
              </p>
            </div>
            <ol className="compatibility-steps">
              <li><span>01</span><code>baseURL</code><small>Point to the future Gitu endpoint.</small></li>
              <li><span>02</span><code>apiKey</code><small>Use a future <b>gitu_xxxxxxxxx</b> key.</small></li>
              <li><span>03</span><code>model</code><small>Select a planned Gitu model.</small></li>
            </ol>
          </div>
        </section>

        <section className="models-operations shell" aria-labelledby="operations-title">
          <div className="models-operations__copy">
            <p className="eyebrow">Provider preview</p>
            <h2 id="operations-title">The same models that power Gitu will be available to your applications.</h2>
            <p>
              The agent integration is not implemented yet. This preview shows the developer platform Gitu is building toward: clear usage, deliberate routing, and an inspectable operational surface.
            </p>
            <div className="pricing-preview">
              <div><span>PRICING / FUTURE</span><strong>Simple usage-based pricing</strong></div>
              <p>Planned around input tokens, cached input tokens, and output tokens.</p>
              <span className="pricing-preview__status">Pricing coming soon</span>
            </div>
          </div>

          <figure className="provider-dashboard" aria-label="Non-functional future Gitu Models dashboard preview">
            <figcaption><span>GITU MODELS</span><b>Preview</b></figcaption>
            <div className="provider-dashboard__metrics">
              <div><span>Balance</span><strong>$—</strong></div>
              <div><span>API requests</span><strong>—</strong></div>
              <div><span>Tokens used</span><strong>—</strong></div>
            </div>
            <div className="provider-dashboard__key"><span>API keys</span><code>gitu_••••••••••</code><small>Preview only</small></div>
            <div className="provider-dashboard__usage"><span>Model usage</span><strong>Coming soon</strong><i aria-hidden="true" /></div>
          </figure>
        </section>

        <section className="models-cta" aria-labelledby="models-cta-title">
          <div className="models-cta__inner shell">
            <p className="eyebrow">EARLY ACCESS / FUTURE PLATFORM</p>
            <h2 id="models-cta-title">Build with Gitu.</h2>
            <p>One API for powerful coding and reasoning models.</p>
            <div className="models-cta__actions" aria-label="Gitu Models preview actions">
              <a href="/register" className="models-cta__primary">Join early access <span aria-hidden="true">↗</span></a>
              <a href="#models-api" className="models-cta__secondary">View API preview</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner shell">
          <strong>GITU</strong>
          <p>Built for developers who want agents to finish what they start.</p>
        </div>
      </footer>
    </div>
  )
}

export default App
