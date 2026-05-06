#!/usr/bin/env python3
"""
GitHub Issues Results Aggregation Script

This script fetches user study results from GitHub issues and provides comprehensive analysis
by aggregating all open issues from the research_survey_result_collect repository.

Usage:
    python aggregate_results_from_github.py --token YOUR_GITHUB_TOKEN
    python aggregate_results_from_github.py --token YOUR_GITHUB_TOKEN --output_dir analysis/
"""

import os
import argparse
import json
import requests
import re
from aggregate_results import UserStudyAggregator

class GitHubIssuesAggregator(UserStudyAggregator):
    def __init__(self, github_token, base_dir=None):
        super().__init__(base_dir)
        self.github_token = github_token
        self.repo_owner = "jinhyukj"
        self.repo_name = "LipForcing_user_study"

    def fetch_github_issues(self):
        """Fetch all open issues from GitHub repository"""
        url = f"https://api.github.com/repos/{self.repo_owner}/{self.repo_name}/issues"
        headers = {
            'Authorization': f'token {self.github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }

        params = {
            'labels': 'user-study-result',
            'state': 'all',  # Get both open and closed issues
            'per_page': 100  # GitHub max per page
        }

        all_issues = []
        page = 1

        while True:
            params['page'] = page
            print(f"Fetching page {page} of issues...")

            response = requests.get(url, headers=headers, params=params)

            if response.status_code != 200:
                print(f"Error fetching issues: {response.status_code} - {response.text}")
                break

            issues = response.json()

            if not issues:  # No more issues
                break

            # Filter out pull requests (GitHub treats PRs as issues)
            issues = [issue for issue in issues if 'pull_request' not in issue]
            all_issues.extend(issues)

            print(f"  Found {len(issues)} issues on page {page}")
            page += 1

            # GitHub pagination check
            if len(issues) < params['per_page']:
                break

        print(f"Total issues fetched: {len(all_issues)}")
        return all_issues

    def extract_results_from_issue(self, issue):
        """Extract JSON results from GitHub issue body"""
        body = issue.get('body', '')

        print(f"  Debug: Issue body preview: {body[:200]}...")

        # Try to extract JSON from markdown code block
        # Pattern: ```json ... ```
        json_pattern = r'```json\s*\n(.*?)\n```'
        matches = re.findall(json_pattern, body, re.DOTALL)

        if matches:
            json_str = matches[0].strip()
            try:
                data = json.loads(json_str)
                print(f"  ✅ Successfully extracted JSON from issue #{issue['number']}")
                return data
            except json.JSONDecodeError as e:
                print(f"  ⚠️ Failed to parse JSON: {e}")
                return None
        else:
            # Try to find JSON block without json marker
            code_block_pattern = r'```\s*\n(.*?)\n```'
            matches = re.findall(code_block_pattern, body, re.DOTALL)
            
            if matches:
                json_str = matches[0].strip()
                # Check if it looks like JSON
                if json_str.strip().startswith('{'):
                    try:
                        data = json.loads(json_str)
                        print(f"  ✅ Successfully extracted JSON (without json marker) from issue #{issue['number']}")
                        return data
                    except json.JSONDecodeError:
                        pass
            
            print(f"  ⚠️ No JSON results found in issue #{issue['number']}: {issue['title']}")
            return None

    def process_user_responses(self, result_data):
        """Process results data from GitHub issue (JSON format)"""
        if not result_data:
            return []
        
        # Convert the JSON format to the format expected by aggregate_results
        responses = []
        participant_id = result_data.get('participantId', 'unknown')
        result_responses = result_data.get('responses', {})
        
        for comparison_name, videos in result_responses.items():
            for video_filename, response_data in videos.items():
                # Handle new format with multiple questions per video
                if isinstance(response_data, dict) and 'answers' in response_data:
                    answers = response_data['answers']
                    # Process each question separately
                    for question_name, choice in answers.items():
                        if choice in ['A', 'B']:
                            chosen_method, other_method, status = self.decode_response(
                                comparison_name, video_filename, choice
                            )
                            if status == 'success':
                                responses.append({
                                    'participant_id': participant_id,
                                    'comparison_name': comparison_name,
                                    'video_filename': video_filename,
                                    'question_name': question_name,
                                    'choice': choice,
                                    'chosen_method': chosen_method,
                                    'other_method': other_method,
                                    'decode_status': status
                                })
                # Handle legacy format (single choice)
                elif isinstance(response_data, str) and response_data in ['A', 'B']:
                    chosen_method, other_method, status = self.decode_response(
                        comparison_name, video_filename, response_data
                    )
                    if status == 'success':
                        responses.append({
                            'participant_id': participant_id,
                            'comparison_name': comparison_name,
                            'video_filename': video_filename,
                            'question_name': 'overall_quality',  # Default for legacy
                            'choice': response_data,
                            'chosen_method': chosen_method,
                            'other_method': other_method,
                            'decode_status': status
                        })
        
        return responses

    def process_github_issues(self):
        """Process all GitHub issues to extract and aggregate results"""
        print("Fetching GitHub issues...")
        issues = self.fetch_github_issues()

        if not issues:
            print("No issues found in repository")
            return []

        all_responses = []

        for i, issue in enumerate(issues, 1):
            print(f"Processing issue {i}/{len(issues)}: #{issue['number']} - {issue['title']}")

            result_data = self.extract_results_from_issue(issue)
            if result_data:
                responses = self.process_user_responses(result_data)
                if responses:
                    all_responses.extend(responses)
                    print(f"  ✅ Extracted {len(responses)} responses")
                else:
                    print(f"  ❌ Failed to process results")
            else:
                print(f"  ⚠️ No valid results found")

        print(f"\nSuccessfully processed {len(all_responses)} users from {len(issues)} issues")
        return all_responses

def main():
    parser = argparse.ArgumentParser(description="Aggregate user study results from GitHub issues")
    parser.add_argument('--token', default='None', help='GitHub personal access token')
    parser.add_argument('--output_dir', default='github_analysis_output', help='Output directory for reports')

    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    print("=" * 60)
    print("GITHUB ISSUES RESULTS AGGREGATION")
    print("=" * 60)
    print(f"Repository: jinhyukj/LipForcing_user_study")
    print(f"Output directory: {args.output_dir}")
    print()

    # Initialize aggregator
    aggregator = GitHubIssuesAggregator(args.token)

    # Process GitHub issues
    all_responses = aggregator.process_github_issues()

    if not all_responses:
        print("No valid responses found in GitHub issues")
        return

    # Aggregate and analyze
    print(f"\nAggregating {len(all_responses)} responses...")
    aggregated = aggregator.aggregate_results(all_responses)

    # Generate report
    report_file = os.path.join(args.output_dir, 'github_study_report.txt')
    report = aggregator.generate_report(aggregated, report_file)
    print("\n" + "="*50)
    print("ANALYSIS COMPLETE")
    print("="*50)
    print(report)

    # Export CSV for easy analysis
    csv_file = os.path.join(args.output_dir, 'github_study_results.csv')
    if aggregated and 'detailed_results' in aggregated:
        import pandas as pd
        df = pd.DataFrame(aggregated['detailed_results'])
        df.to_csv(csv_file, index=False)
        print(f"  📈 CSV: {csv_file}")

    print(f"\nFiles generated:")
    print(f"  📊 Report: {report_file}")
    if aggregated and 'detailed_results' in aggregated:
        print(f"  📈 CSV: {csv_file}")

if __name__ == "__main__":
    main()