// Audio-driven lip-sync user study — main logic.
// Renders sections one at a time, loads 4 synced videos per section, collects
// ratings on the 3 unlabeled (non-GT) videos, submits to /api/submit-results.

(() => {
'use strict';

const STORAGE_KEY      = 'lipForcingStudyState';
const STORAGE_RESULTS  = 'lipForcingStudyResults';

let CONFIG = null;
let STATE = {
    participantId: null,
    phone: null,
    startTime: null,
    sectionIndex: -1,        // -1 = pre-study landing not yet completed; 0..N = sections; N = done
    assignment: [],          // length = N samples; each entry = [model_a, model_b, model_c]  (display order)
    responses: [],           // length = N; each entry: { sampleStem, slots: [{model, scores: {sync,quality,id_pres,natural}}] for 3 result videos }
};

let SYNC_SUPPRESS = false;

// ---------------- INIT ----------------

async function init() {
    try {
        CONFIG = await fetch('data/study_config.json').then(r => r.json());
    } catch (e) {
        document.body.innerHTML = '<p style="padding:24px;color:red">Failed to load study config: ' + e + '</p>';
        return;
    }

    document.getElementById('study-title').textContent = CONFIG.study_title;

    // Restore prior progress if any
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.participantId && parsed.assignment && parsed.assignment.length === CONFIG.samples.length) {
                STATE = parsed;
            }
        } catch {}
    }

    if (!STATE.participantId) {
        // Fresh start: assign and dive straight into section 1. The phone
        // number, if any, was captured on index.html and stashed in
        // localStorage under 'lipForcingPhonePrefill' — pick it up here
        // and consume the prefill so a refresh doesn't re-stamp it.
        STATE.participantId = 'p_' + Math.random().toString(36).slice(2, 10);
        STATE.startTime = Date.now();
        try {
            const prefill = localStorage.getItem('lipForcingPhonePrefill');
            STATE.phone = prefill ? prefill : null;
            localStorage.removeItem('lipForcingPhonePrefill');
        } catch {
            STATE.phone = null;
        }
        STATE.assignment = generateAssignment();
        STATE.responses = STATE.assignment.map((slot_models, i) => ({
            sampleStem: CONFIG.samples[i],
            slots: slot_models.map(m => ({ model: m, scores: {} })),
        }));
        STATE.sectionIndex = 0;
        persist();
        renderSection(0);
    } else if (STATE.sectionIndex >= CONFIG.samples.length) {
        showCompletion();
    } else {
        renderSection(Math.max(0, STATE.sectionIndex));
    }
}

function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}

// ---------------- ASSIGNMENT ----------------
// Generate a per-participant model assignment satisfying:
//  - Each section has 3 distinct models (out of 7).
//  - Total counts: ours_14b appears 6 sections, each baseline appears 4 sections.
//  - Order of the 3 models within each section is randomized.
function generateAssignment() {
    const N_SECTIONS = CONFIG.samples.length;  // 10
    const counts = {...CONFIG.model_counts};   // {ours_14b: 6, wav2lip: 4, ...}

    // Build a 30-element multiset
    const pool = [];
    for (const [model, n] of Object.entries(counts)) {
        for (let i = 0; i < n; i++) pool.push(model);
    }
    if (pool.length !== N_SECTIONS * 3) {
        throw new Error(`Model counts sum to ${pool.length}, expected ${N_SECTIONS * 3}`);
    }

    // Repeatedly shuffle + distribute until each section has 3 distinct models.
    for (let attempt = 0; attempt < 1000; attempt++) {
        shuffle(pool);
        const sections = [];
        let valid = true;
        for (let s = 0; s < N_SECTIONS; s++) {
            const trio = pool.slice(s * 3, s * 3 + 3);
            if (new Set(trio).size !== 3) { valid = false; break; }
            sections.push(trio);
        }
        if (valid) {
            // Final shuffle of the order WITHIN each section (already random due to outer shuffle, but make explicit)
            sections.forEach(t => shuffle(t));
            return sections;
        }
    }
    throw new Error('Failed to generate valid model assignment after 1000 attempts');
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// ---------------- SECTION ----------------

function renderSection(idx) {
    showScreen('section-screen');
    const sample = CONFIG.samples[idx];
    const slots  = STATE.responses[idx].slots;   // [{model, scores}, ...] length 3

    document.getElementById('section-heading').textContent =
        `Sample ${idx + 1} of ${CONFIG.samples.length}`;

    setProgress((idx) / CONFIG.samples.length);
    document.getElementById('progress-text').textContent =
        `Section ${idx} of ${CONFIG.samples.length}`;

    // --- video row ---
    const videoRow = document.getElementById('video-row');
    videoRow.innerHTML = '';
    const videoEls = [];

    // GT first
    const gtCell = makeVideoCell({
        label: 'Ground Truth',
        url: `${CONFIG.video_dir}/${sample}/gt.mp4`,
        muted: false,
        isGt: true,
    });
    videoRow.appendChild(gtCell.cell);
    videoEls.push(gtCell.video);

    // 3 result slots (no labels — blind)
    slots.forEach((slot, i) => {
        // Mute results so we hear GT audio only (avoid 4 audio tracks at once)
        const c = makeVideoCell({
            label: `Video ${String.fromCharCode(65 + i)}`,   // A, B, C
            url: `${CONFIG.video_dir}/${sample}/${slot.model}.mp4`,
            muted: true,
            isGt: false,
        });
        videoRow.appendChild(c.cell);
        videoEls.push(c.video);
    });

    // Wire up sync between the 4 videos
    syncVideoGroup(videoEls);

    // --- ratings row ---
    const ratingsRow = document.getElementById('ratings-row');
    ratingsRow.innerHTML = '';

    // GT column: empty placeholder
    const gtPad = document.createElement('div');
    gtPad.className = 'rating-cell gt-empty';
    gtPad.textContent = '(no rating needed for Ground Truth)';
    ratingsRow.appendChild(gtPad);

    // Result columns: 4 rating questions per video
    slots.forEach((slot, slotIdx) => {
        const cell = document.createElement('div');
        cell.className = 'rating-cell';
        const heading = document.createElement('div');
        heading.style.fontWeight = '700';
        heading.style.fontSize = '17px';
        heading.style.marginBottom = '12px';
        heading.style.color = '#374151';
        heading.textContent = `Video ${String.fromCharCode(65 + slotIdx)}`;
        cell.appendChild(heading);

        CONFIG.questions.forEach(q => {
            const block = document.createElement('div');
            block.className = 'q-block';
            const lbl = document.createElement('div');
            lbl.className = 'q-label';
            lbl.innerHTML = `<span class="label-en">${escHtml(q.label)}</span>` +
                            (q.label_ko ? `<span class="label-ko">${escHtml(q.label_ko)}</span>` : '');
            const txt = document.createElement('div');
            txt.className = 'q-text';
            txt.innerHTML = `<span class="text-en">${escHtml(q.text)}</span>` +
                            (q.text_ko ? `<span class="text-ko">${escHtml(q.text_ko)}</span>` : '');
            block.appendChild(lbl);
            block.appendChild(txt);

            const scale = document.createElement('div');
            scale.className = 'scale';
            const groupName = `q_${idx}_${slotIdx}_${q.id}`;
            for (let v = CONFIG.rating_scale.min; v <= CONFIG.rating_scale.max; v++) {
                const id = `${groupName}_${v}`;
                const lblWrap = document.createElement('label');
                lblWrap.htmlFor = id;
                const inp = document.createElement('input');
                inp.type = 'radio';
                inp.name = groupName;
                inp.id = id;
                inp.value = v;
                if (slot.scores[q.id] === v) inp.checked = true;
                inp.addEventListener('change', () => {
                    slot.scores[q.id] = v;
                    persist();
                    refreshNavState(idx);
                });
                const bullet = document.createElement('span');
                bullet.className = 'radio-bullet';
                bullet.textContent = String(v);
                lblWrap.appendChild(inp);
                lblWrap.appendChild(bullet);
                scale.appendChild(lblWrap);
            }
            block.appendChild(scale);
            cell.appendChild(block);
        });

        ratingsRow.appendChild(cell);
    });

    // --- nav ---
    document.getElementById('prev-btn').disabled = (idx === 0);
    document.getElementById('prev-btn').onclick = () => {
        STATE.sectionIndex = Math.max(0, idx - 1);
        persist();
        renderSection(STATE.sectionIndex);
    };
    document.getElementById('next-btn').onclick = () => {
        if (idx + 1 >= CONFIG.samples.length) {
            STATE.sectionIndex = CONFIG.samples.length;   // sentinel: done
            persist();
            showCompletion();
        } else {
            STATE.sectionIndex = idx + 1;
            persist();
            renderSection(STATE.sectionIndex);
        }
    };
    refreshNavState(idx);
}

function refreshNavState(idx) {
    const slots = STATE.responses[idx].slots;
    const required = slots.length * CONFIG.questions.length;
    let answered = 0;
    slots.forEach(s => {
        CONFIG.questions.forEach(q => { if (s.scores[q.id] !== undefined) answered++; });
    });
    document.getElementById('answered-status').textContent =
        `${answered} / ${required} answered`;
    document.getElementById('next-btn').disabled = (answered < required);
    if (idx + 1 >= CONFIG.samples.length) {
        document.getElementById('next-btn').textContent = 'Submit ▶';
    } else {
        document.getElementById('next-btn').textContent = 'Next ▶';
    }
}

function makeVideoCell({label, url, muted, isGt}) {
    const cell = document.createElement('div');
    cell.className = 'video-cell' + (isGt ? ' is-gt' : '');

    const lbl = document.createElement('div');
    lbl.className = 'video-label';
    lbl.textContent = label;
    cell.appendChild(lbl);

    const v = document.createElement('video');
    v.src = url;
    v.loop = true;
    v.muted = muted;
    v.preload = 'auto';
    v.playsInline = true;
    cell.appendChild(v);

    // Force first frame to render so the element doesn't show blank when paused.
    // preload="auto" loads bytes but doesn't always paint the first frame; a
    // tiny seek nudges the renderer. Different browsers (esp. Safari, mobile
    // Chrome) need the nudge at different lifecycle events, so try at all of
    // loadedmetadata / loadeddata / canplay, plus a delayed fallback. Each
    // attempt is idempotent — once one paints, the rest are no-ops.
    let firstFramePainted = false;
    const nudgeFirstFrame = () => {
        if (firstFramePainted) return;
        if (v.readyState < 1) return;
        try {
            v.currentTime = Math.max(0.01, v.currentTime);
            firstFramePainted = true;
        } catch (e) {
            // try again later via the next event in the chain
        }
    };
    v.addEventListener('loadedmetadata', nudgeFirstFrame);
    v.addEventListener('loadeddata',     nudgeFirstFrame);
    v.addEventListener('canplay',        nudgeFirstFrame);
    // Last-resort fallback: 800ms after creation, if still nothing painted, force it.
    setTimeout(nudgeFirstFrame, 800);
    setTimeout(nudgeFirstFrame, 2000);

    const seekRow = document.createElement('div');
    seekRow.className = 'seek-row';
    const playBtn = document.createElement('button');
    playBtn.className = 'play-btn';
    playBtn.textContent = '▶';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = 0;
    range.max = 1000;
    range.value = 0;
    range.step = 1;

    playBtn.addEventListener('click', () => {
        if (v.paused) v.play(); else v.pause();
    });
    v.addEventListener('play', () => playBtn.textContent = '❚❚');
    v.addEventListener('pause', () => playBtn.textContent = '▶');

    range.addEventListener('input', () => {
        if (!v.duration) return;
        const t = (range.value / 1000) * v.duration;
        if (Math.abs(v.currentTime - t) > 0.04) v.currentTime = t;
    });
    v.addEventListener('timeupdate', () => {
        if (!v.duration) return;
        const value = Math.round((v.currentTime / v.duration) * 1000);
        if (range.matches(':active')) return;   // user is dragging
        range.value = value;
    });

    seekRow.appendChild(playBtn);
    seekRow.appendChild(range);
    cell.appendChild(seekRow);

    return { cell, video: v };
}

// Sync a group of <video> elements: scrubbing/playing one moves all to the same
// position. Uses currentTime + play/pause propagation; handles loops naturally
// because each video has the loop attribute (very-short videos resync each
// time anyway since we propagate seeks).
function syncVideoGroup(videos) {
    const setAll = (fn) => {
        SYNC_SUPPRESS = true;
        videos.forEach(fn);
        // release after the next event loop tick
        setTimeout(() => { SYNC_SUPPRESS = false; }, 30);
    };

    videos.forEach(v => {
        v.addEventListener('seeking', () => {
            if (SYNC_SUPPRESS) return;
            const t = v.currentTime;
            setAll(other => { if (other !== v) other.currentTime = t; });
        });
        v.addEventListener('play', () => {
            if (SYNC_SUPPRESS) return;
            setAll(other => { if (other !== v && other.paused) other.play().catch(() => {}); });
        });
        v.addEventListener('pause', () => {
            if (SYNC_SUPPRESS) return;
            setAll(other => { if (other !== v && !other.paused) other.pause(); });
        });
    });

    // Drift correction: every 500ms, snap others to the first non-paused video's time.
    // Cheap insurance for tiny drifts during loop.
    setInterval(() => {
        const driver = videos.find(v => !v.paused);
        if (!driver) return;
        videos.forEach(v => {
            if (v === driver) return;
            if (Math.abs(v.currentTime - driver.currentTime) > 0.15) {
                SYNC_SUPPRESS = true;
                v.currentTime = driver.currentTime;
                setTimeout(() => { SYNC_SUPPRESS = false; }, 30);
            }
        });
    }, 500);

    // No auto-play — browsers silently block autoplay of unmuted media without
    // a recent user gesture, which makes the GT cell look blank. Instead, the
    // first frame of each video is forced to render via the loadedmetadata
    // seek (above), and the user clicks Play on any of the four videos to
    // start all four together (play propagates via the listeners above).
}

// ---------------- COMPLETION + SUBMISSION ----------------

async function showCompletion() {
    showScreen('completion-screen');
    setProgress(1);
    document.getElementById('progress-text').textContent =
        `Done — ${CONFIG.samples.length} of ${CONFIG.samples.length}`;

    const payload = buildPayload();
    // Keep payload in localStorage as a backup so the researcher can recover
    // it from the participant's browser if auto-submission fails. NOT displayed.
    localStorage.setItem(STORAGE_RESULTS, JSON.stringify(payload));

    const status = document.getElementById('submission-status');
    status.textContent = 'Submitting your responses…';

    try {
        const res = await fetch('/api/submit-results', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        await res.json();
        status.className = 'ok';
        status.textContent = '✓ Submitted successfully.';
    } catch (e) {
        console.error('Submission error:', e);
        status.className = 'err';
        status.textContent = '⚠ Auto-submission failed. Please contact the researcher; your responses are still saved on this device.';
    }
}

function buildPayload() {
    return {
        timestamp: new Date().toISOString(),
        participantId: STATE.participantId,
        phone: STATE.phone || null,
        studyDuration: Date.now() - STATE.startTime,
        config: {
            samples: CONFIG.samples,
            models: CONFIG.models,
            model_counts: CONFIG.model_counts,
        },
        responses: STATE.responses.map(r => ({
            sample: r.sampleStem,
            videos: r.slots.map(s => ({ model: s.model, scores: s.scores })),
        })),
    };
}

// ---------------- HELPERS ----------------

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}
function setProgress(frac) {
    document.getElementById('progress-bar').style.setProperty('--progress', `${Math.round(frac * 100)}%`);
}
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function escAttr(s) { return escHtml(s); }

// ---------------- BOOT ----------------

document.addEventListener('DOMContentLoaded', init);

// Expose a debug handle for testing in console
window.__study = { get state() { return STATE; }, get config() { return CONFIG; }, reset() { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_RESULTS); location.reload(); } };

})();
