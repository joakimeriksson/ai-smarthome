import os
import json
import toml
from pathlib import Path
from github import Github
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Dict

class ContikiContributorsDataset:
    def __init__(self, config_file: str = "config.toml"):
        # Load configuration
        with open(config_file, 'r') as f:
            self.config = toml.load(f)
        
        # Setup GitHub client
        self.gh = Github(self.config['github']['token'])
        
        # Get the main repository config (first one in the list)
        self.repo_config = self.config['repositories'][0]
        self.repo = self.gh.get_repo(self.repo_config['repo_full_name'])
        
        # Setup output directory
        self.output_dir = Path(self.config['dataset']['output_dir'])
        self.output_dir.mkdir(exist_ok=True)

    def get_contributor_stats(self) -> List[Dict]:
        """Get detailed statistics about contributors."""
        contributors_data = []
        
        # Get contributors statistics
        stats = self.repo.get_stats_contributors()
        if stats:
            for stat in stats:
                contributor = stat.author
                
                # Basic contributor info
                contrib_data = {
                    "login": contributor.login,
                    "name": contributor.name if contributor.name else contributor.login,
                    "email": contributor.email if contributor.email else "Not provided",
                    "company": contributor.company if contributor.company else "Not provided",
                    "bio": contributor.bio if contributor.bio else "Not provided",
                    "total_commits": stat.total,
                    "weeks_active": len([w for w in stat.weeks if w.c > 0]),
                    "lines_added": sum(w.a for w in stat.weeks),
                    "lines_deleted": sum(w.d for w in stat.weeks),
                    "first_contribution": min(w.w.isoformat() for w in stat.weeks if w.c > 0),
                    "last_contribution": max(w.w.isoformat() for w in stat.weeks if w.c > 0),
                }
                
                # Create instruction-response pairs
                contributors_data.append({
                    "instruction": f"Who is {contributor.login} in the Contiki-NG project?",
                    "response": self._format_contributor_response(contrib_data),
                    "source": "GitHub API - Contributors Statistics"
                })
                
                contributors_data.append({
                    "instruction": f"What are {contributor.login}'s main contributions to Contiki-NG?",
                    "response": self._format_contribution_response(contrib_data),
                    "source": "GitHub API - Contributors Statistics"
                })
                
        return contributors_data

    def get_maintainers(self) -> List[Dict]:
        """Get information about project maintainers from CODEOWNERS and maintainers files."""
        maintainers_data = []
        
        try:
            # Try to get CODEOWNERS content
            codeowners = self.repo.get_contents("CODEOWNERS")
            if codeowners:
                content = codeowners.decoded_content.decode('utf-8')
                maintainers = set()
                for line in content.split('\n'):
                    if line.strip() and not line.startswith('#'):
                        # Extract GitHub usernames (those starting with @)
                        usernames = [word.strip('@') for word in line.split() if word.startswith('@')]
                        maintainers.update(usernames)
                
                # Create dataset entries for maintainers
                for username in maintainers:
                    maintainers_data.append({
                        "instruction": f"What is {username}'s role in maintaining Contiki-NG?",
                        "response": f"{username} is a maintainer of Contiki-NG, responsible for code review and project maintenance as specified in the CODEOWNERS file.",
                        "source": "CODEOWNERS file"
                    })
        except:
            pass  # File might not exist
            
        return maintainers_data

    def get_recent_activity(self) -> List[Dict]:
        """Get information about recent project activity."""
        activity_data = []
        
        # Get recent commits
        commits = self.repo.get_commits()[:100]  # Last 100 commits
        commit_by_author = defaultdict(list)
        
        for commit in commits:
            if commit.author:
                commit_by_author[commit.author.login].append(commit)
        
        # Create activity summaries
        for author, author_commits in commit_by_author.items():
            recent_work = {
                "author": author,
                "commit_count": len(author_commits),
                "recent_changes": [c.commit.message.split('\n')[0] for c in author_commits[:5]]
            }
            
            activity_data.append({
                "instruction": f"What has {author} been working on recently in Contiki-NG?",
                "response": self._format_activity_response(recent_work),
                "source": "GitHub API - Recent Commits"
            })
            
        return activity_data

    def _format_contributor_response(self, data: Dict) -> str:
        """Format contributor information into a readable response."""
        return f"{data['name']} ({data['login']}) is a contributor to Contiki-NG who has been active from {data['first_contribution']} to {data['last_contribution']}. " + \
               f"They have made {data['total_commits']} commits over {data['weeks_active']} weeks, " + \
               f"adding {data['lines_added']} lines and removing {data['lines_deleted']} lines of code. " + \
               (f"They work at {data['company']}. " if data['company'] != "Not provided" else "") + \
               (f"{data['bio']}" if data['bio'] != "Not provided" else "")

    def _format_contribution_response(self, data: Dict) -> str:
        """Format contribution information into a readable response."""
        return f"{data['name']} has been a significant contributor to Contiki-NG, making {data['total_commits']} commits. " + \
               f"Their contributions span {data['weeks_active']} weeks of activity, during which they've added {data['lines_added']} " + \
               f"lines and removed {data['lines_deleted']} lines of code. Their first contribution was on {data['first_contribution']}, " + \
               f"and their most recent activity was on {data['last_contribution']}."

    def _format_activity_response(self, data: Dict) -> str:
        """Format recent activity information into a readable response."""
        recent_changes = "\n- " + "\n- ".join(data['recent_changes'])
        return f"{data['author']} has made {data['commit_count']} recent commits to Contiki-NG. Their most recent contributions include:{recent_changes}"

    def generate_dataset(self):
        """Generate the complete contributors dataset."""
        print("Gathering contributor statistics...")
        contributors = self.get_contributor_stats()
        
        print("Identifying maintainers...")
        maintainers = self.get_maintainers()
        
        print("Analyzing recent activity...")
        activity = self.get_recent_activity()
        
        # Combine all data
        dataset = contributors + maintainers + activity
        
        # Save as JSONL
        output_file = self.output_dir / "contiki_contributors_dataset.jsonl"
        with open(output_file, 'w', encoding='utf-8') as f:
            for item in dataset:
                f.write(json.dumps(item) + '\n')
        
        print(f"Generated dataset with {len(dataset)} examples")
        print(f"Dataset saved to {output_file}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate Contiki-NG contributors dataset')
    parser.add_argument('--config', default='config.toml', help='Path to config file')
    args = parser.parse_args()
    
    generator = ContikiContributorsDataset(config_file=args.config)
    generator.generate_dataset()
