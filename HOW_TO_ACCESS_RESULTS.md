# How to Access User Study Results

## 🚀 Quick Setup for Vercel Deployment

**If you're getting "Automatic submission failed" error:**

1. **Create GitHub Personal Access Token**:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Name it (e.g., "Vercel User Study")
   - Select scope: `repo` (full control of private repositories)
   - Generate and copy the token

2. **Add to Vercel**:
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add new variable:
     - **Name**: `GITHUB_TOKEN`
     - **Value**: Paste your token
     - **Environments**: Select ALL (Production, Preview, Development)
   - Click "Save"

3. **Redeploy**:
   - After adding the environment variable, trigger a new deployment
   - Go to Deployments → Click "Redeploy" or push a new commit

4. **Verify**:
   - The `api/submit-results.js` serverless function should now work
   - Test by completing a study - it should submit automatically

## Overview
The user study collects answers in real-time and stores them in two ways:
1. **Browser localStorage** (temporary, per-user)
2. **GitHub Issues** (permanent, when study is completed via serverless function)

## Answer Collection Process

### 1. During the Study (Real-time Storage)
- **Location**: Browser's `localStorage`
- **Keys**:
  - `userStudyResponses`: All answers for each video
  - `userStudyProgress`: Current position in the study
  - `userStudyFinalResults`: Final results when study is completed
- **Format**: JSON objects stored as strings

### 2. After Completion (Permanent Storage)
- **Location**: GitHub Issues in the repository
- **Method**: Automatically creates a GitHub issue with all results
- **Issue Title**: `User Study Results - {participantId}`
- **Issue Labels**: `user-study-result`, `data-collection`

## How to Access Results

### Option 1: From Browser (During/After Study)
1. Open browser Developer Tools (F12)
2. Go to "Application" tab (Chrome) or "Storage" tab (Firefox)
3. Expand "Local Storage" → `http://localhost:8000`
4. Look for keys:
   - `userStudyResponses` - Current answers
   - `userStudyFinalResults` - Final results (if completed)

### Option 2: From GitHub Issues
1. Go to: `https://github.com/jinhyukj/LipForcing_user_study/issues`
2. Look for issues with label `user-study-result`
3. Each issue contains:
   - Participant ID
   - Demographics
   - All responses (JSON format)
   - Completion time

### Option 3: Using Python Scripts (Recommended for Analysis)

#### Collect Results from GitHub:
```bash
cd /data/hyunbin/long_video/DeepSink_user_study/data
python collect_simple_fixed.py --token YOUR_GITHUB_TOKEN
```

#### Aggregate All Results:
```bash
python aggregate_results_from_github.py --token YOUR_GITHUB_TOKEN
```

## Data Structure

### Response Format (per video):
```json
{
  "answers": {
    "color_consistency": "A",
    "dynamic_motion": "B",
    "subject_consistency": "A",
    "overall_quality": "A"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Final Results Format:
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "participantId": "user_12345",
  "demographics": {
    "age": "25-34",
    "experience": "intermediate"
  },
  "responses": {
    "deepsink_vs_self_forcing": {
      "30s_2_comparison.mp4": {
        "answers": {
          "color_consistency": "A",
          "dynamic_motion": "B",
          "subject_consistency": "A",
          "overall_quality": "A"
        },
        "timestamp": "..."
      },
      ...
    },
    ...
  },
  "studyDuration": 900000
}
```

## Important Notes

1. **GitHub Token**: 
   - **For Vercel Deployment**: Set `GITHUB_TOKEN` in Vercel Environment Variables (Settings → Environment Variables)
   - **For Local Development**: You can set it in `js/study.js` (line ~567), but **DO NOT commit tokens to GitHub**
   - **Security Warning**: Exposing GitHub tokens in client-side code is a security risk. Consider using Vercel serverless functions for production
   - **Token Permissions**: The token needs `repo` scope to create issues
   - **Same Token for Vercel**: Yes, you can use the same GitHub Personal Access Token for both Vercel deployment and the Python analysis scripts

2. **Order Sheets**: The A/B mapping is stored in `order_sheet.txt` files in each comparison folder
3. **Video Mapping**: Each video filename maps to a basename (e.g., `30s_2_comparison.mp4` → `30s_2`)
4. **Prompt Text**: Video prompts are stored in `prompt_text.json`
5. **Comparison Sets**: Current study uses:
   - `deepsink_vs_self_forcing`
   - `deepsink_vs_long_live`
   - `deepsink_vs_causvid`
   - `deepsink_vs_rolling_forcing`
6. **Questions**: Each video is evaluated on:
   - `color_consistency`: Color and exposure consistency
   - `dynamic_motion`: Dynamic and varied motion
   - `subject_consistency`: Visual consistency of main subject
   - `overall_quality`: Overall realism and quality

## Vercel Deployment Setup

1. **Video Files**:
   - ✅ **Videos MUST be in the repository** for Vercel to serve them
   - Currently: ~80 videos (~927MB total) are included in the repository
   - Videos are stored in `user_study_comparisons/` folders
   - **Size Considerations**:
     - GitHub: 100MB per file limit (individual videos are ~5-10MB, so OK)
     - Vercel Free: 100MB deployment limit (may need Pro plan for ~927MB)
     - **Alternative**: If hitting limits, consider hosting videos on:
       - External CDN (Cloudflare, AWS CloudFront)
       - Object storage (AWS S3, Google Cloud Storage)
       - GitHub Releases (download on-demand)
   - If using external hosting, update video paths in `study_config.json` and `js/study.js`

2. **Set Environment Variable** (REQUIRED):
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add `GITHUB_TOKEN` with your GitHub Personal Access Token
   - **Important**: Make sure to select ALL environments (Production, Preview, Development)
   - **Token Permissions**: The token needs `repo` scope to create issues
   - After adding the variable, **redeploy your project** for it to take effect

3. **GitHub Token Security**:
   - ✅ **DO**: Store token in Vercel Environment Variables (server-side only)
   - ✅ **DO**: Use the same token for both Vercel and Python scripts (if needed)
   - ❌ **DON'T**: Commit tokens to GitHub (already excluded in `.gitignore`)
   - ✅ **SECURE**: Token is stored server-side in Vercel serverless function (`api/submit-results.js`)
   - ✅ **SECURE**: Token is never exposed to client-side JavaScript

4. **Repository Configuration**:
   - Repository: `jinhyukj/LipForcing_user_study`
   - Issues are created with labels: `user-study-result`, `data-collection`

## Troubleshooting

- **Can't see results**: Check browser console for errors
- **GitHub submission failed / "Automatic submission failed"**: 
  - ✅ **Check Vercel Environment Variables**: Go to Vercel Dashboard → Settings → Environment Variables
  - ✅ **Verify `GITHUB_TOKEN` is set**: Must be named exactly `GITHUB_TOKEN`
  - ✅ **Check all environments**: Ensure token is enabled for Production, Preview, AND Development
  - ✅ **Redeploy after adding token**: Changes to env vars require a new deployment
  - ✅ **Check token permissions**: Token needs `repo` scope to create issues
  - ✅ **Verify token hasn't expired**: Generate a new token if needed
  - ✅ **Check serverless function**: Ensure `api/submit-results.js` exists in your repository
  - ✅ **Check browser console**: Look for error messages about the API call
- **Missing data**: Check if study was completed (not just started)
- **Python scripts not working**: 
  - Verify repository name is correct (`jinhyukj/LipForcing_user_study`)
  - Check that comparison folder names match your study configuration
  - Ensure order sheets exist in each comparison folder
- **Videos not loading on Vercel**:
  - Check that videos are committed to the repository (not in `.gitignore`)
  - Verify video paths in `study_config.json` match the folder structure
  - Check browser console for 404 errors on video files
  - If deployment size exceeds Vercel limits, consider upgrading plan or using external hosting
  - Ensure video file sizes are under 100MB each (GitHub limit)

