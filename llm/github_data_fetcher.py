import sys
from github import Github
from tqdm import tqdm
import toml
import git

# Load configuration from config.toml
config = toml.load('config.toml')
GITHUB_TOKEN = config['github']['token']

# Get the main repository config (first one in the list)
repo_config = config['repositories'][0]
REPO_FULL_NAME = repo_config['repo_full_name']
LOCAL_REPO_PATH = repo_config['local_repo_path']
LOCAL_REPO_BRANCH = repo_config['local_repo_branch']

def fetch_commits_from_local_repo(repo_path):
    commits = []
    repo = git.Repo(repo_path)
    all_commits = list(repo.iter_commits(LOCAL_REPO_BRANCH))

    for commit in tqdm(all_commits, desc='Commits'):
        #diff = commit.diff(None, create_patch=True)
        #diff_text = ''.join([d.diff.decode('utf-8') for d in diff])
        commits.append({
            'sha': commit.hexsha,
            'message': commit.message,
            #'diff': diff_text
        })

    return commits

def fetch_data(repo):
    issues = []
    pull_requests = []
    commits = []

    # Fetch issues
    print(f"Fetching issues for {repo.full_name}...")
    all_issues = repo.get_issues(state='closed')
    print(f"Found {all_issues.totalCount} issues.")
    for issue in tqdm(all_issues, desc='Issues'):
        issues.append({
            'id': issue.number,
            'title': issue.title,
            'body': issue.body,
            'comments': [comment.body for comment in issue.get_comments()]
        })

    # Fetch pull requests
    print(f"Fetching pull requests for {repo.full_name}...")
    all_pull_requests = repo.get_pulls(state='closed')
    for pr in tqdm(all_pull_requests, desc='Pull Requests'):
        pull_requests.append({
            'id': pr.number,
            'title': pr.title,
            'body': pr.body,
            'commits': [commit.commit.message for commit in pr.get_commits()]
        })

    # Fetch commits from local repository
    print(f"Fetching commits from local repository at {LOCAL_REPO_PATH}...")
    commits = fetch_commits_from_local_repo(LOCAL_REPO_PATH)

    return issues, pull_requests, commits

def link_issues_to_fixes(issues, pull_requests, commits):
    issue_to_fix = {}
    for issue in issues:
        issue_to_fix[issue['id']] = []

    # Link via PRs
    for pr in pull_requests:
        for commit_message in pr['commits']:
            # Check if commit message closes an issue
            if 'closes #' in commit_message.lower():
                # Extract the part after the '#'
                issue_number_part = commit_message.split('#')[1].split()[0]
                # Ensure it's numeric before converting to int
                issue_number = int(''.join(filter(str.isdigit, issue_number_part)))
                if issue_number in issue_to_fix:
                    issue_to_fix[issue_number].append({
                        'type': 'PR',
                        'title': pr['title'],
                        'body': pr['body']
                    })

    repo = git.Repo(LOCAL_REPO_PATH)
    # Link via commits
    for commit in commits:
        try:
            if 'closes #' in commit['message'].lower():
                issue_number_part = commit['message'].split('#')[1].split()[0]
                issue_number = int(''.join(filter(str.isdigit, issue_number_part)))
                if issue_number in issue_to_fix:
                    commitobject = repo.commit(commit['sha'])
                    diff = commitobject.diff(None, create_patch=True)
                    diff_text = ''.join([d.diff.decode('utf-8') for d in diff])
                    issue_to_fix[issue_number].append({
                        'type': 'Commit',
                        'message': commit['message'],
                        'diff': diff_text
                    })
        except Exception as e:
            print(f"Error processing commit linking: {str(e)}")
            continue
    return issue_to_fix

def generate_dataset(issues, issue_to_fix):
    dataset = []
    for issue in issues:
        fixes = issue_to_fix.get(issue['id'], [])
        if fixes:
            for fix in fixes:
                if fix['type'] == 'PR':
                    dataset.append({
                        'prompt': issue['body'],
                        'response': fix['body']
                    })
                elif fix['type'] == 'Commit':
                    dataset.append({
                        'prompt': issue['body'],
                        'response': fix['message']
                    })
    return dataset

def main():
    try:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(REPO_FULL_NAME)
        print(f"Fetching data for {repo.full_name}...")
        issues, pull_requests, commits = fetch_data(repo)
        print(f"Fetched {len(issues)} issues, {len(pull_requests)} pull requests, and {len(commits)} commits.")
        issue_to_fix = link_issues_to_fixes(issues, pull_requests, commits)
        dataset = generate_dataset(issues, issue_to_fix)

        # Save dataset to a JSON file
        import json
        with open('dataset.json', 'w') as f:
            json.dump(dataset, f, indent=4)

        print(f"Dataset saved to dataset.json with {len(dataset)} entries.")

    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
