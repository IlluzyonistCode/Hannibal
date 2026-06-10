'use strict';

const state = {
    settings: {},
    currentView: 'menu',
    trainerMode: 'paraphrase',
    metaphorSub: 'random',
    debateSituation: '',
    debateReady: false,
    randomTimer: null,
    randomSecs: 30,
    randomItem: null,
    sphereTimer: null,
    sphereSecs: 120,
    sphereData: null,
    evoCurrentMetaphor: '',
    evoRound: 0,
    evoHistory: [],
    profilerCancel: false
};

window.addEventListener('DOMContentLoaded', async () => {
    state.settings = await api.getSettings();

    checkApiKey();
    bindNav();
    bindSettings();
    bindTrainer();
    bindProfiler();
    bindLexicon();
    showView('menu');

    addMsg('chat-paraphrase', 'ai',
        'Good evening. I am ready to operate on your idiom. Enter a phrase.');
});

function bindNav() {
    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => showView(btn.dataset.view));
    });

    document.querySelectorAll('[data-goto]').forEach(card => {
        card.addEventListener('click', () => showView(card.dataset.goto));
    });
}

function showView(name) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active-view');
        v.classList.add('hidden');
    });

    const el = document.getElementById('view-' + name);

    if (!el) return;

    el.classList.remove('hidden');
    el.classList.add('active-view');

    state.currentView = name;

    if (name === 'lexicon') loadLexicon();
}

async function checkApiKey() {
    const key = await api.getApiKey();
    const banner = document.getElementById('api-banner');

    if (!key) banner.classList.remove('hidden');
    
    else banner.classList.add('hidden');

    const ms = document.getElementById('menu-status');

    if (ms) ms.textContent = key ? '● API key configured' : '○ API key not set — open Settings';
}

async function aiCall(messages, tempOverride) {
    const result = await api.aiCall(messages, tempOverride);

    if (result.error) throw new Error(result.error);

    return result.content;
}

function systemMsg(content) { return { role: 'system', content }; }

function userMsg(content) { return { role: 'user', content }; }

function langPrompt() {
    return `Respond in ${state.settings.language || 'Russian'}.`;
}

function toast(msg, isError = false) {
    const el = document.getElementById('toast');

    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast-error' : '');

    setTimeout(() => el.classList.add('hidden'), 4000);
}

function addMsg(chatId, sender, html, isHtml = false) {
    const chat = document.getElementById(chatId);

    if (!chat) return;

    const div = document.createElement('div');

    div.className = sender === 'ai' ? 'ai-msg' : 'user-msg';

    if (isHtml) div.innerHTML = html;

    else div.textContent = html;

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;

    return div;
}

function addSpinner(chatId) {
    const div = addMsg(chatId, 'ai', '<span class="dots">⬛⬛⬛</span>', true);

    return div;
}

function makeSaveBtn(entry, label = '🔖 Save to Lexicon') {
    const btn = document.createElement('button');

    btn.className = 'save-vocab-btn';
    btn.textContent = label;

    btn.addEventListener('click', async () => {
        await api.lexAdd(entry);

        btn.textContent = '✅ Saved';
        btn.disabled = true;
        btn.classList.add('saved');
    });

    return btn;
}

function bindSettings() {
    const openBtn = document.getElementById('settings-open-btn');
    const closeBtn = document.getElementById('settings-close-btn');
    const modal = document.getElementById('settings-modal');

    openBtn.addEventListener('click', async () => {
        await populateSettings();

        modal.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    const slider = document.getElementById('temp-slider');
    const tempVal = document.getElementById('temp-val');

    slider.addEventListener('input', () => { tempVal.textContent = slider.value; });

    ['model-select', 'lang-select', 'store-checkbox'].forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettings);
    });

    slider.addEventListener('change', saveSettings);

    document.getElementById('api-key-input').addEventListener('change', async () => {
        const key = document.getElementById('api-key-input').value.trim();

        await api.saveApiKey(key);

        checkApiKey();
    });

    document.getElementById('btn-test-key').addEventListener('click', testKey);

    document.getElementById('btn-clear-all').addEventListener('click', async () => {
        if (!confirm('Delete all lexicon entries and history? This is irreversible.')) return;

        await api.lexClearAll();

        toast('All data cleared.');
    });
}

async function populateSettings() {
    state.settings = await api.getSettings();

    document.getElementById('model-select').value = state.settings.model;
    document.getElementById('lang-select').value = state.settings.language;
    document.getElementById('temp-slider').value = state.settings.temp;
    document.getElementById('temp-val').textContent = state.settings.temp;
    document.getElementById('store-checkbox').checked = state.settings.store;
    document.getElementById('api-key-input').value = await api.getApiKey();
}

async function saveSettings() {
    const s = {
        model: document.getElementById('model-select').value,
        language: document.getElementById('lang-select').value,
        temp: parseFloat(document.getElementById('temp-slider').value),
        store: document.getElementById('store-checkbox').checked
    };

    await api.saveSettings(s);

    state.settings = { ...state.settings, ...s };
}

async function testKey() {
    const key = document.getElementById('api-key-input').value.trim();
    const status = document.getElementById('key-status');

    if (!key) {
        status.textContent = '○ No key entered.';
        status.className = 'key-status bad';

        return;
    }

    await api.saveApiKey(key);

    status.textContent = '⟳ Testing…';
    status.className = 'key-status';

    try {
        const r = await aiCall([userMsg('Say OK')]);

        if (r && r.length > 0) {
            status.textContent = '● Connected';
            status.className = 'key-status good';

            checkApiKey();
        }

        else throw new Error('Empty response');
    } catch (error) {
        status.textContent = '✕ Invalid key: ' + error.message.slice(0, 80);
        status.className = 'key-status bad';
    }
}

function bindTrainer() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMetaphorSub(btn.dataset.sub));
    });

    bindParaphrase();
    bindDebate();
    bindMetaphorLab();
}

function switchMode(mode) {
    state.trainerMode = mode;

    document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });

    document.querySelectorAll('.mode-panel').forEach(p => {
        p.classList.toggle('active-panel', p.id === 'panel-' + mode);
        p.classList.toggle('hidden', p.id !== 'panel-' + mode);
    });

    const subgroup = document.getElementById('metaphor-submodes');

    subgroup.classList.toggle('hidden', mode !== 'metaphor');

    const desc = document.getElementById('mode-description');

    const descriptions = {
        paraphrase: 'Transform mundane thoughts into elegant constructs.',
        debate: 'Face situations. Be evaluated. Evolve.',
        metaphor: 'Forge unexpected metaphors under pressure.',
    };

    desc.textContent = descriptions[mode] || '';
}

function switchMetaphorSub(sub) {
    state.metaphorSub = sub;

    document.querySelectorAll('.sub-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sub === sub);
    });

    document.querySelectorAll('.sub-panel').forEach(p => {
        p.classList.toggle('active-sub', p.id === 'sub-' + sub);
        p.classList.toggle('hidden', p.id !== 'sub-' + sub);
    });
}

function bindParaphrase() {
    const btn = document.getElementById('send-paraphrase');
    const input = document.getElementById('input-paraphrase');

    btn.addEventListener('click', doParaphrase);

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            doParaphrase();
        }
    });
}

async function doParaphrase() {
    const input = document.getElementById('input-paraphrase');
    const text = input.value.trim();

    if (!text) return;

    input.value = '';

    addMsg('chat-paraphrase', 'user', text);

    const spinner = addSpinner('chat-paraphrase');

    const prompt = `${langPrompt()}

Here is a text to rewrite. Elevate it in an elegant, slightly arrogant, sophisticated style. Preserve the meaning. Then provide brief analysis.

Respond EXACTLY in this format:
Original: ${text}
Ideal Version: [your version]
Analysis: [what you changed and why]

Text: "${text}"`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        const orig = extract(raw, 'Original', 'Ideal Version') || text;
        const ideal = extract(raw, 'Ideal Version', 'Analysis') || raw;
        const analysis = extractAfter(raw, 'Analysis') || '';

        const card = document.createElement('div');

        card.className = 'ai-msg';
        card.innerHTML = `
            <div class="result-block">
                <div class="result-label">Ideal Version</div>
                <div class="highlight-text">${esc(ideal)}</div>
            </div>
            <div class="analysis-block">${esc(analysis)}</div>
        `;

        const saveBtn = makeSaveBtn({
            type: 'phrase',
            content: ideal,
            definition: analysis,
            original: text,
            source: 'Paraphrase'
        });

        card.appendChild(saveBtn);

        document.getElementById('chat-paraphrase').appendChild(card);
        document.getElementById('chat-paraphrase').scrollTop = 99999;
    } catch (error) {
        spinner.remove();

        addMsg('chat-paraphrase', 'ai', '✕ Error: ' + error.message);
    }
}

function bindDebate() {
    document.getElementById('btn-new-situation').addEventListener('click', startSituation);
    document.getElementById('send-debate').addEventListener('click', submitDebateResponse);

    document.getElementById('input-debate').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            submitDebateResponse();
        }
    });
}

async function startSituation() {
    state.debateReady = false;

    const btn = document.getElementById('btn-new-situation');

    btn.disabled = true;

    const spinner = addSpinner('chat-debate');

    const prompt = `${langPrompt()}

Generate a realistic, somewhat uncomfortable social situation in which one person behaves rudely, passive-aggressively, or manipulatively. Describe it in 3–5 sentences. No evaluation, no advice. Just the situation.`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        state.debateSituation = raw.trim();
        state.debateReady = true;

        addMsg('chat-debate', 'ai', `<strong>Situation:</strong><br>${esc(state.debateSituation)}`, true);
    } catch (error) {
        spinner.remove();

        addMsg('chat-debate', 'ai', '✕ ' + error.message);
    }

    btn.disabled = false;
}

async function submitDebateResponse() {
    if (!state.debateReady) {
        toast('Generate a situation first.', true);

        return;
    }

    const input = document.getElementById('input-debate');
    const text = input.value.trim();

    if (!text) return;

    input.value = '';

    addMsg('chat-debate', 'user', text);

    const spinner = addSpinner('chat-debate');

    const prompt = `${langPrompt()}

Situation: ${state.debateSituation}
Student's response: ${text}

Evaluate the response. Respond EXACTLY in this format:
Score: [1–10]
Critique: [what was weak or missing]
Ideal Version: [your ideal response]
Word of the Day: [a rare or beautiful word relevant to the situation]
Definition: [the word's definition]`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        const score = extract(raw, 'Score', 'Critique') ? .trim() || '?';
        const critique = extract(raw, 'Critique', 'Ideal Version') ? .trim() || raw;
        const ideal = extract(raw, 'Ideal Version', 'Word of the Day') ? .trim() || '';
        const word = extract(raw, 'Word of the Day', 'Definition') ? .trim() || '';
        const wordDef = extractAfter(raw, 'Definition') ? .trim() || '';

        const card = document.createElement('div');
        card.className = 'ai-msg';
        card.innerHTML = `
            <div class="score-circle">${esc(score)}<span class="score-ten">/10</span></div>
            <p class="critique-text">${esc(critique)}</p>
            <div class="result-block">
                <div class="result-label">Ideal Version</div>
                <div class="highlight-text">${esc(ideal)}</div>
            </div>
            <div class="vocab-block">
                <strong class="accent-text">${esc(word)}</strong>
                <br><small>${esc(wordDef)}</small>
            </div>
        `;

        if (ideal) card.appendChild(makeSaveBtn({ type: 'phrase', content: ideal, definition: 'Debate: ' + state.debateSituation, source: 'Debate' }));
        if (word) card.appendChild(makeSaveBtn({ type: 'word', content: word, definition: wordDef, source: 'Debate' }, '🔖 Save Word'));

        document.getElementById('chat-debate').appendChild(card);
        document.getElementById('chat-debate').scrollTop = 99999;

        state.debateReady = false;
    } catch (error) {
        spinner.remove();

        addMsg('chat-debate', 'ai', '✕ ' + error.message);
    }
}

function bindMetaphorLab() {
    document.getElementById('btn-gen-item').addEventListener('click', genRandomItem);
    document.getElementById('send-random').addEventListener('click', submitRandomMetaphor);

    document.getElementById('btn-gen-sphere').addEventListener('click', genSphere);
    document.getElementById('send-sphere').addEventListener('click', submitSphereMetaphors);

    document.getElementById('btn-suggest-cliche').addEventListener('click', suggestCliche);
    document.getElementById('btn-evo-begin').addEventListener('click', beginEvolution);
    document.getElementById('btn-evo-submit').addEventListener('click', submitEvoReplacement);
}

function startRandomTimer() {
    clearInterval(state.randomTimer);

    state.randomSecs = 30;

    updateTimerDisplay('timer-random', 30);

    state.randomTimer = setInterval(() => {
        state.randomSecs--;

        updateTimerDisplay('timer-random', state.randomSecs);

        if (state.randomSecs <= 0) {
            clearInterval(state.randomTimer);

            timerExpired('send-random', 'btn-gen-item');
        }
    }, 1000);
}

function timerExpired(sendBtnId, genBtnId) {
    const sendBtn = document.getElementById(sendBtnId);
    const genBtn = document.getElementById(genBtnId);

    if (sendBtn) sendBtn.disabled = true;

    toast('Time is up. Generate a new item.', true);
}

function updateTimerDisplay(id, secs) {
    const el = document.getElementById(id);

    if (!el) return;

    const m = Math.floor(secs / 60);
    const s = secs % 60;

    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.className = 'timer-display' + (secs <= 10 ? ' timer-urgent' : '');
}

async function genRandomItem() {
    const display = document.getElementById('item-display');
    const sendBtn = document.getElementById('send-random');

    sendBtn.disabled = true;

    display.innerHTML = '<span class="dots">⬛⬛⬛</span>';

    clearInterval(state.randomTimer);

    const prompt = `${langPrompt()}

Suggest one ordinary everyday object that is NEVER used in cliché metaphors about romantic desire. Do NOT use fire, water, or animals. Then write a provocative question that forces an unexpected angle.

Format:
Object: [object]
Question: [provocative question]`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        const obj = extract(raw, 'Object', 'Question') ? .trim() || raw;
        const question = extractAfter(raw, 'Question') ? .trim() || '';

        state.randomItem = { obj, question };

        display.innerHTML = `
            <div class="item-card">
                <div class="item-name">${esc(obj)}</div>
                <div class="item-question">${esc(question)}</div>
            </div>
        `;

        sendBtn.disabled = false;

        startRandomTimer();
    } catch (error) {
        display.textContent = '✕ ' + error.message;
    }
}

async function submitRandomMetaphor() {
    if (!state.randomItem) { toast('Generate an item first.', true); return; }

    clearInterval(state.randomTimer);

    const input = document.getElementById('input-random');
    const text = input.value.trim();

    if (!text) return;

    input.value = '';

    addMsg('chat-random', 'user', text);

    const spinner = addSpinner('chat-random');

    const prompt = `${langPrompt()}

The user was given:
Object: ${state.randomItem.obj}
Question: ${state.randomItem.question}

The user's metaphor: "${text}"

Notice one interesting detail in their metaphor. Then suggest one unexpected twist for the same object. Respond in two short sentences.`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        const card = document.createElement('div');
        card.className = 'ai-msg';
        card.innerHTML = `<p>${esc(raw)}</p>`;

        card.appendChild(makeSaveBtn({ type: 'phrase', content: text, definition: 'Object: ' + state.randomItem.obj, source: 'Metaphor Lab / Random', original: text }));
        card.appendChild(makeSaveBtn({ type: 'phrase', content: raw, definition: 'AI twist on: ' + state.randomItem.obj, source: 'Metaphor Lab / Random' }, '🔖 Save AI Twist'));

        document.getElementById('chat-random').appendChild(card);
        document.getElementById('chat-random').scrollTop = 99999;
    } catch (error) {
        spinner.remove();

        addMsg('chat-random', 'ai', '✕ ' + error.message);
    }
}

function startSphereTimer() {
    clearInterval(state.sphereTimer);

    state.sphereSecs = 120;

    updateTimerDisplay('timer-sphere', 120);

    state.sphereTimer = setInterval(() => {
        state.sphereSecs--;

        updateTimerDisplay('timer-sphere', state.sphereSecs);

        if (state.sphereSecs <= 0) {
            clearInterval(state.sphereTimer);

            toast('Time is up! Submit what you have.', true);
        }
    }, 1000);
}

async function genSphere() {
    const display = document.getElementById('sphere-display');
    const inputBox = document.getElementById('sphere-inputs');
    const submitA = document.getElementById('sphere-submit-area');

    display.innerHTML = '<span class="dots">⬛⬛⬛</span>';
    inputBox.classList.add('hidden');
    submitA.style.display = 'none';

    clearInterval(state.sphereTimer);

    const spheres = 'cooking, plumbing, dentistry, programming, construction, economics, optics, watchmaking, farming, hunting, aviation, neurobiology, beekeeping, blacksmithing, glassblowing';

    const prompt = `${langPrompt()}

Choose a random sphere from: ${spheres}
From that sphere, give 5 concrete physical nouns or verbs.

Format EXACTLY:
Sphere: [sphere]
Terms: [t1], [t2], [t3], [t4], [t5]`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        const sphere = extract(raw, 'Sphere', 'Terms') ? .trim() || 'Unknown';
        const termsRaw = extractAfter(raw, 'Terms') ? .trim() || '';
        const terms = termsRaw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);

        state.sphereData = { sphere, terms };

        display.innerHTML = `
            <div class="item-card">
                <div class="sphere-name">Sphere: <strong>${esc(sphere)}</strong></div>
                <div class="sphere-terms">${terms.map(t => `<span class="term-badge">${esc(t)}</span>`).join(' ')}</div>
            </div>
        `;

        inputBox.innerHTML = '';
        inputBox.classList.remove('hidden');

        terms.forEach((term, i) => {
            const row = document.createElement('div');
            row.className = 'sphere-input-row';
            row.innerHTML = `
                <label class="sphere-term-label">${esc(term)}</label>
                <textarea class="sphere-metaphor-input" data-i="${i}" placeholder="Your metaphor for '${esc(term)}'…" rows="2"></textarea>
            `;
            inputBox.appendChild(row);
        });

        submitA.style.display = 'flex';

        startSphereTimer();
    } catch (error) {
        display.textContent = '✕ ' + error.message;
    }
}

async function submitSphereMetaphors() {
    if (!state.sphereData) { toast('Generate a sphere first.', true); return; }

    clearInterval(state.sphereTimer);

    const inputs = document.querySelectorAll('.sphere-metaphor-input');
    const { sphere, terms } = state.sphereData;
    const metaphors = [];

    inputs.forEach((inp, i) => metaphors.push(inp.value.trim() || '(empty)'));

    const spinner = addSpinner('chat-sphere');

    const pairs = terms.map((t, i) => `${i+1}. ${t} — ${metaphors[i]}`).join('\n');

    const prompt = `${langPrompt()}

Sphere: ${sphere}
Term — Metaphor pairs:
${pairs}

For each metaphor, suggest ONE word replacement that would make it more surprising, more physical, or unusual.

Output EXACTLY:
1. replace '[word]' with '[replacement]'
2. replace '[word]' with '[replacement]'
… (5 total)`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        const table = document.createElement('div');
        table.className = 'ai-msg sphere-result';

        const lines = raw.split('\n').filter(l => /^\d\./.test(l.trim())).slice(0, 5);

        let tableHtml = `<div class="sphere-table">
            <div class="sth">Term</div>
            <div class="sth">Your Metaphor</div>
            <div class="sth">Suggested Replacement</div>`;

        terms.forEach((term, i) => {
            const suggestion = lines[i] || '—';
            tableHtml += `
                <div class="stc">${esc(term)}</div>
                <div class="stc">${esc(metaphors[i])}</div>
                <div class="stc accent-text">${esc(suggestion)}</div>
            `;
        });

        tableHtml += '</div>';
        table.innerHTML = tableHtml;

        terms.forEach((term, i) => {
            if (metaphors[i] && metaphors[i] !== '(empty)')
                table.appendChild(makeSaveBtn({
                    type: 'phrase',
                    content: metaphors[i],
                    definition: 'Sphere: ' + sphere + ' / Term: ' + term,
                    source: 'Metaphor Lab / Sphere',
                }, `🔖 Save #${i+1}`));
        });

        document.getElementById('chat-sphere').appendChild(table);
        document.getElementById('chat-sphere').scrollTop = 99999;
    } catch (error) {
        spinner.remove();

        addMsg('chat-sphere', 'ai', '✕ ' + error.message);
    }
}

async function suggestCliche() {
    const input = document.getElementById('input-evo-start');

    input.value = '⬛⬛⬛';

    const prompt = `${langPrompt()} Give ONE single cliché metaphor about romantic desire. Just the metaphor, nothing else.`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        input.value = raw.trim();
    } catch (error) {
        input.value = '';

        toast('Error: ' + error.message, true);
    }
}

async function beginEvolution() {
    const input = document.getElementById('input-evo-start');
    const text = input.value.trim();

    if (!text || text === '⬛⬛⬛') {
        toast('Enter a cliché first.', true);

        return;
    }

    state.evoCurrentMetaphor = text;
    state.evoRound = 0;
    state.evoHistory = [text];

    document.getElementById('chat-evolution').innerHTML = '';

    addMsg('chat-evolution', 'ai', `<strong>Starting metaphor:</strong><br>"${esc(text)}"`, true);

    document.getElementById('evo-start-area').classList.add('hidden');
    document.getElementById('evo-round-area').classList.remove('hidden');

    await runEvoRound();
}

async function runEvoRound() {
    if (state.evoRound >= 3) {
        endEvolution();

        return;
    }

    state.evoRound++;

    const spinner = addSpinner('chat-evolution');

    const prompt = `${langPrompt()}

Current metaphor: "${state.evoCurrentMetaphor}"

This is round ${state.evoRound} of 3.

Identify ONE element (subject, object, adjective, or verb) that can be replaced with something from everyday life, technology, or food. Do NOT give the replacement yourself. Ask the user: "What would you replace [element] with?"

Reply ONLY with that question.`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        addMsg('chat-evolution', 'ai', raw.trim());

        document.getElementById('input-evo-round').placeholder = 'Your replacement…';
        document.getElementById('input-evo-round').value = '';
    } catch (error) {
        spinner.remove();

        addMsg('chat-evolution', 'ai', '✕ ' + error.message);
    }
}

async function submitEvoReplacement() {
    const input = document.getElementById('input-evo-round');
    const replacement = input.value.trim();

    if (!replacement) return;

    input.value = '';

    addMsg('chat-evolution', 'user', replacement);

    const spinner = addSpinner('chat-evolution');

    const prompt = `${langPrompt()}

Current metaphor: "${state.evoCurrentMetaphor}"
The user wants to replace an element with: "${replacement}"

You now replace a DIFFERENT element in the resulting metaphor. Output ONLY the new full evolved metaphor, nothing else.`;

    try {
        const raw = await aiCall([userMsg(prompt)]);

        spinner.remove();

        state.evoCurrentMetaphor = raw.trim();
        state.evoHistory.push(raw.trim());

        const card = document.createElement('div');
        card.className = 'ai-msg';
        card.innerHTML = `<div class="result-label">Round ${state.evoRound}</div>
                          <div class="highlight-text">"${esc(raw.trim())}"</div>`;

        card.appendChild(makeSaveBtn({
            type: 'phrase',
            content: raw.trim(),
            definition: 'Evolution round ' + state.evoRound,
            source: 'Metaphor Lab / Evolution',
            original: state.evoHistory[0]
        }));

        document.getElementById('chat-evolution').appendChild(card);
        document.getElementById('chat-evolution').scrollTop = 99999;

        if (state.evoRound < 3) await runEvoRound();
        
        else endEvolution();
    } catch (error) {
        spinner.remove();

        addMsg('chat-evolution', 'ai', '✕ ' + error.message);
    }
}

function endEvolution() {
    document.getElementById('evo-round-area').classList.add('hidden');
    document.getElementById('evo-start-area').classList.remove('hidden');

    const final = state.evoCurrentMetaphor;

    const card = document.createElement('div');
    card.className = 'ai-msg evo-final';
    card.innerHTML = `
        <div class="result-label">✦ Final Evolved Metaphor</div>
        <div class="highlight-text" style="font-size:1.15em">"${esc(final)}"</div>
    `;

    card.appendChild(makeSaveBtn({
        type: 'phrase',
        content: final,
        definition: 'Evolved from: ' + state.evoHistory[0],
        source: 'Metaphor Lab / Evolution',
        original: state.evoHistory[0],
    }, '🔖 Save Final'));

    document.getElementById('chat-evolution').appendChild(card);
    document.getElementById('chat-evolution').scrollTop = 99999;
}

function bindProfiler() {
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const cancelBtn = document.getElementById('btn-cancel-profiler');

    zone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) handleProfilerFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', e => {
        e.preventDefault();

        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

    zone.addEventListener('drop', e => {
        e.preventDefault();

        zone.classList.remove('drag-over');

        if (e.dataTransfer.files[0]) handleProfilerFile(e.dataTransfer.files[0]);
    });

    cancelBtn.addEventListener('click', () => { state.profilerCancel = true; });
}

async function handleProfilerFile(file) {
    if (file.size > 10 * 1024 * 1024)
        if (!confirm('File is larger than 10 MB. Processing may take several minutes. Continue?')) return;

    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');

    setProfilerStatus('Parsing evidence…');

    let messages = [];

    try {
        messages = isJson ? parseJsonChat(text) : parsePlainChat(text);
    } catch (error) {
        setProfilerStatus('Parse error: ' + error.message, true);

        return;
    }

    if (messages.length === 0) {
        setProfilerStatus('No messages found.', true);

        return;
    }

    setProfilerStatus(`Found ${messages.length} messages. Starting analysis…`);

    document.getElementById('btn-cancel-profiler').style.display = 'block';

    state.profilerCancel = false;

    const metrics = computeMetrics(messages);

    renderMetrics(metrics);

    const fullText = messages.map(m => `[${m.from}]: ${m.text}`).join('\n');
    const chunks = chunkText(fullText, 6000, 500);

    const progress = document.getElementById('profiler-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressLabel = document.getElementById('progress-label');

    progress.classList.remove('hidden');

    const chunkAnalyses = [];

    for (let i = 0; i < chunks.length; i++) {
        if (state.profilerCancel) break;

        progressLabel.textContent = `Analyzing chunk ${i+1} / ${chunks.length}…`;
        progressFill.style.width = `${((i+1) / chunks.length) * 100}%`;

        const chunkPrompt = `Analyze this chat fragment as a forensic behavioral profiler. Extract facts about power dynamics, hidden motives, manipulation tactics, emotional subtext. Be dry, factual, ruthless. Ignore small talk. Quote specific phrases.

${chunks[i]}`;

        try {
            const analysis = await aiCall([userMsg(chunkPrompt)]);

            chunkAnalyses.push(analysis);
        } catch (error) {
            chunkAnalyses.push('[Chunk analysis failed: ' + error.message + ']');
        }
    }

    if (state.profilerCancel) {
        setProfilerStatus('Analysis cancelled.', true);

        progress.classList.add('hidden');

        document.getElementById('btn-cancel-profiler').style.display = 'none';

        return;
    }

    setProfilerStatus('Synthesizing profiles…');

    const names = Object.keys(metrics).join(', ');
    const aggregated = chunkAnalyses.join('\n\n---\n\n');

    const lang = state.settings.language || 'Russian';

    const synthPrompt = `Synthesize these observations into a psychological profile of each participant: ${names}.

Write in the style of Hannibal Lecter – elegant, cruel, full of metaphors from anatomy, cuisine, and classical music. Mock mediocrity. The output must be in ${lang}.

Use the format === PROFILE: [Name] === for each person.

Observations:
${aggregated}`;

    try {
        const profile = await aiCall([userMsg(synthPrompt)]);

        renderProfiles(profile);
        setProfilerStatus('Analysis complete.');
    } catch (error) {
        setProfilerStatus('Synthesis failed: ' + error.message, true);
    }

    progress.classList.add('hidden');

    document.getElementById('btn-cancel-profiler').style.display = 'none';
}

function parseJsonChat(text) {
    const data = JSON.parse(text);

    if (Array.isArray(data))
        return data.map(m => ({ from: m.from || m.sender || 'Unknown', text: m.text || m.message || '' }));

    throw new Error('JSON must be an array of messages.');
}

function parsePlainChat(text) {
    const lines = text.split('\n');
    const msgs = [];
    const re = /^\[?([^,\]]+)[,\]]\s*[\d.:\s]+\]\s*:\s*(.+)$/;

    for (const line of lines) {
        const m = re.exec(line.trim());

        if (m) msgs.push({ from: m[1].trim(), text: m[2].trim() });

        else if (msgs.length > 0 && line.trim()) msgs[msgs.length - 1].text += ' ' + line.trim();
    }

    return msgs;
}

function computeMetrics(messages) {
    const metrics = {};

    for (const m of messages) {
        if (!metrics[m.from]) metrics[m.from] = { total_messages: 0, total_words: 0 };

        metrics[m.from].total_messages++;
        metrics[m.from].total_words += m.text.split(/\s+/).length;
    }

    const totalWords = Object.values(metrics).reduce((s, v) => s + v.total_words, 0);

    for (const name of Object.keys(metrics)) {
        metrics[name].dominance_ratio = totalWords ?
            Math.round((metrics[name].total_words / totalWords) * 100) :
            0;
    }

    return metrics;
}

function renderMetrics(metrics) {
    const container = document.getElementById('profiler-metrics');

    container.innerHTML = '';
    container.classList.remove('hidden');

    for (const [name, data] of Object.entries(metrics)) {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `
            <div class="participant-name">${esc(name)}</div>
            <div class="metric-row"><span>Messages</span><span class="val">${data.total_messages}</span></div>
            <div class="metric-row"><span>Dominance</span><span class="val accent-text">${data.dominance_ratio}%</span></div>
        `;
        container.appendChild(card);
    }
}

function renderProfiles(markdownText) {
    const tabs = document.getElementById('report-tabs');
    const content = document.getElementById('report-content');

    tabs.innerHTML = '';
    tabs.classList.remove('hidden');
    content.innerHTML = '';

    const pattern = /===\s*PROFILE:\s*(.+?)\s*===/g;
    const matches = [];
    let m;

    while ((m = pattern.exec(markdownText)) !== null)
        matches.push({ name: m[1].trim(), start: m.index + m[0].length });

    if (matches.length === 0) {
        content.innerHTML = `<div class="report-text">${simpleMarkdown(markdownText)}</div>`;

        return;
    }

    matches.forEach((cur, i) => {
        const next = matches[i + 1];
        const section = markdownText.slice(cur.start, next ? next.index : undefined).trim();

        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        btn.textContent = cur.name;

        if (i === 0) {
            btn.classList.add('active');

            content.innerHTML = `<div class="report-text">${simpleMarkdown(section)}</div>`;
        }

        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

            btn.classList.add('active');

            content.innerHTML = `<div class="report-text">${simpleMarkdown(section)}</div>`;
        });

        tabs.appendChild(btn);
    });
}

function chunkText(text, size = 6000, overlap = 500) {
    const chunks = [];
    let i = 0;

    while (i < text.length) {
        chunks.push(text.slice(i, i + size));

        i += size - overlap;
    }

    return chunks;
}

function setProfilerStatus(msg, isError = false) {
    const el = document.getElementById('profiler-status');
    el.textContent = msg;
    el.style.color = isError ? '#c62828' : 'var(--accent)';
}

let lexDebounce = null;

function bindLexicon() {
    document.getElementById('lex-search').addEventListener('input', () => {
        clearTimeout(lexDebounce);

        lexDebounce = setTimeout(loadLexicon, 300);
    });

    document.getElementById('lex-lang-filter').addEventListener('change', loadLexicon);

    document.getElementById('lex-export-btn').addEventListener('click', async () => {
        await api.lexExport();
    });

    document.getElementById('lex-import-btn').addEventListener('click', async () => {
        const n = await api.lexImport();

        if (n > 0) {
            toast(`Imported ${n} entries.`);

            loadLexicon();
        }
    });

    document.getElementById('lex-add-btn').addEventListener('click', () => {
        document.getElementById('add-entry-modal').classList.remove('hidden');
    });

    document.getElementById('add-entry-close').addEventListener('click', () => {
        document.getElementById('add-entry-modal').classList.add('hidden');
    });

    document.getElementById('add-entry-modal').addEventListener('click', e => {
        if (e.target.id === 'add-entry-modal') e.target.classList.add('hidden');
    });

    document.getElementById('ae-save-btn').addEventListener('click', async () => {
        const content = document.getElementById('ae-content').value.trim();

        if (!content) { toast('Content is required.', true); return; }

        await api.lexAdd({
            type: document.getElementById('ae-type').value,
            content,
            definition: document.getElementById('ae-definition').value.trim(),
            language: document.getElementById('ae-lang').value,
            source: 'Manual'
        });

        document.getElementById('add-entry-modal').classList.add('hidden');
        document.getElementById('ae-content').value = '';
        document.getElementById('ae-definition').value = '';

        toast('Entry saved.');

        loadLexicon();
    });
}

async function loadLexicon() {
    const grid = document.getElementById('lex-grid');
    const search = document.getElementById('lex-search').value.trim();
    const lang = document.getElementById('lex-lang-filter').value;

    grid.innerHTML = '<div class="loading-pulse">Loading Mind Palace…</div>';

    try {
        const [entries, langs] = await Promise.all([
            api.lexList({ search, lang }),
            api.lexLanguages()
        ]);

        const filter = document.getElementById('lex-lang-filter');
        const prev = filter.value;

        filter.innerHTML = '<option value="all">All languages</option>';

        langs.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = l;

            if (l === prev) opt.selected = true;

            filter.appendChild(opt);
        });

        renderLexicon(entries);
    } catch (error) {
        grid.innerHTML = '<p class="empty-hint">Error loading archive.</p>';
    }
}

function renderLexicon(entries) {
    const grid = document.getElementById('lex-grid');

    grid.innerHTML = '';

    if (!entries || entries.length === 0) {
        grid.innerHTML = '<p class="empty-hint">Archive is empty.</p>';

        return;
    }

    entries.forEach(item => {
        const card = document.createElement('div');
        card.className = 'vocab-card';

        const isPhrase = item.type === 'phrase';

        card.innerHTML = `
            <div class="vocab-type-badge">${isPhrase ? 'PHRASE' : 'WORD'}</div>
            ${item.language ? `<div class="vocab-lang-badge">${esc(item.language)}</div>` : ''}
            <div class="vocab-main">${esc(item.content)}</div>
            <div class="vocab-sub">${esc(item.definition || '')}</div>
            ${item.original ? `<div class="vocab-original">↳ ${esc(item.original.slice(0, 80))}${item.original.length > 80 ? '…' : ''}</div>` : ''}
            <div class="vocab-footer">
                <span class="vocab-source">${esc(item.source || '')}</span>
                <span class="vocab-date">${formatDate(item.created_at)}</span>
            </div>
            <button class="delete-btn" data-id="${item.id}" title="Delete">×</button>
        `;

        card.querySelector('.delete-btn').addEventListener('click', async e => {
            e.stopPropagation();

            if (!confirm('Delete this entry?')) return;

            await api.lexDelete(item.id);

            loadLexicon();
        });

        grid.appendChild(card);
    });
}

function esc(str) {
    if (!str) return '';

    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function extract(text, from, to) {
    const re = new RegExp(`(?:^|\\n)${from}:\\s*([\\s\\S]*?)(?=\\n${to}:|$)`, 'i');
    const m = re.exec(text);

    return m ? m[1].trim() : null;
}

function extractAfter(text, from) {
    const re = new RegExp(`(?:^|\\n)${from}:\\s*([\\s\\S]*)$`, 'i');
    const m = re.exec(text);

    return m ? m[1].trim() : null;
}

function simpleMarkdown(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^###\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^##\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^#\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}

function formatDate(str) {
    if (!str) return '';

    const d = new Date(str);

    return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}
