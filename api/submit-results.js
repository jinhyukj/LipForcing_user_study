// Vercel serverless function to submit user study results to GitHub.
// Reads GITHUB_TOKEN from env, files results as a labeled GitHub Issue on
// jinhyukj/LipForcing_user_study, returns the issue URL.

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
        console.error('GITHUB_TOKEN environment variable is not set');
        return res.status(500).json({
            error: 'Server configuration error: GitHub token not configured',
            message: 'Set GITHUB_TOKEN in Vercel Environment Variables and redeploy'
        });
    }

    const results = req.body;
    if (!results) {
        return res.status(400).json({ error: 'No results data provided' });
    }

    const githubOwner = 'jinhyukj';
    const githubRepo  = 'LipForcing_user_study';

    // ---- compute per-model average scores for at-a-glance summary ----
    const modelAggregates = {};   // model → {sync: [v...], quality: [...], ...}
    (results.responses || []).forEach(section => {
        (section.videos || []).forEach(video => {
            const model = video.model;
            if (!modelAggregates[model]) modelAggregates[model] = {};
            Object.entries(video.scores || {}).forEach(([qid, val]) => {
                if (!modelAggregates[model][qid]) modelAggregates[model][qid] = [];
                modelAggregates[model][qid].push(val);
            });
        });
    });

    const fmtAvg = (xs) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '—';
    const summaryRows = Object.entries(modelAggregates).map(([model, qs]) => {
        const cells = ['sync', 'quality', 'id_pres', 'natural']
            .map(qid => fmtAvg(qs[qid] || []))
            .join(' | ');
        return `| ${model} | ${cells} |`;
    }).join('\n');

    // ---- build issue body ----
    const issueData = {
        title: `User Study Results - ${results.participantId}`,
        body: `## User Study Results

**Participant ID:** \`${results.participantId}\`
**Completed:** ${new Date(results.timestamp).toLocaleString()}
**Duration:** ${Math.round(results.studyDuration / 1000 / 60)} minutes
**Sections:** ${(results.responses || []).length}

### Per-model average scores (this participant)

| Model | Sync | Video Quality | ID Preservation | Naturalness |
|-------|------|---------------|-----------------|-------------|
${summaryRows}

### Raw responses

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`

---
*Auto-submitted at ${new Date().toISOString()}*`,
        labels: ['user-study-result', 'data-collection']
    };

    try {
        const response = await fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(issueData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('GitHub API error:', response.status, errorData);
            return res.status(response.status).json({
                error: `GitHub API error: ${response.status}`,
                message: errorData.message || 'Failed to create GitHub issue'
            });
        }

        const issue = await response.json();
        return res.status(200).json({
            success: true,
            issue_url: issue.html_url,
            issue: { number: issue.number, url: issue.html_url }
        });
    } catch (error) {
        console.error('Error submitting to GitHub:', error);
        return res.status(500).json({
            error: 'Failed to submit results',
            message: error.message || 'Unknown error'
        });
    }
}
