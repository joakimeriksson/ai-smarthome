import sys
import toml
import git
import json
from typing import List, Dict, Any
from pathlib import Path
from tqdm import tqdm

class PretrainingDatasetCreator:
    def __init__(self, config_path: str = 'config.toml'):
        self.config = toml.load(config_path)
        
    def process_repositories(self) -> List[Dict[str, Any]]:
        """Process all repositories defined in the config file."""
        dataset = []
        
        for repo_config in self.config['repositories']:
            print(f"\nProcessing repository: {repo_config['local_repo_path']}")
            try:
                repo_data = self._process_single_repository(repo_config)
                dataset.extend(repo_data)
            except Exception as e:
                print(f"Error processing repository {repo_config['local_repo_path']}: {str(e)}")
                continue
                
        return dataset

    def _process_single_repository(self, repo_config: Dict[str, str]) -> List[Dict[str, Any]]:
        """Process a single repository and generate training examples."""
        local_repo = git.Repo(repo_config['local_repo_path'])
        dataset = []
        
        # Collect commit-based examples
        dataset.extend(self._create_commit_examples(local_repo, repo_config['local_repo_branch']))
        
        # Collect all text and code files
        dataset.extend(self._collect_repository_files(repo_config['local_repo_path']))
        
        return dataset

    def _create_commit_examples(self, repo: git.Repo, branch: str) -> List[Dict[str, Any]]:
        """Create training examples from commit messages and diffs."""
        examples = []
        
        for commit in tqdm(list(repo.iter_commits(branch)), desc='Processing commits'):
            try:
                # Get the commit message and diff
                message = commit.message.strip()
                diff = commit.diff(commit.parents[0] if commit.parents else git.NULL_TREE)
                
                # More robust diff handling
                diff_texts = []
                for d in diff:
                    try:
                        if isinstance(d.diff, bytes):
                            diff_texts.append(d.diff.decode('utf-8'))
                        elif isinstance(d.diff, str):
                            diff_texts.append(d.diff)
                        else:
                            continue
                    except Exception as e:
                        print(f"Warning: Could not process diff in commit {commit.hexsha}: {str(e)}")
                        continue
                
                diff_text = '\n'.join(diff_texts)
                
                if len(message.split('\n')) > 1:
                    title, body = message.split('\n', 1)
                    examples.append({
                        'type': 'commit_message_generation',
                        'input': diff_text,
                        'output': message,
                        'metadata': {'sha': commit.hexsha}
                    })
                    
                    examples.append({
                        'type': 'commit_message_explanation',
                        'input': title.strip(),
                        'output': body.strip(),
                        'metadata': {'sha': commit.hexsha}
                    })
                
            except Exception as e:
                print(f"Error processing commit {commit.hexsha}: {str(e)}")
                continue
                
        return examples

    def _collect_repository_files(self, repo_path: str) -> List[Dict[str, Any]]:
        """Collect all text and code files from the repository."""
        examples = []
        repo_path = Path(repo_path)
        
        # Get configuration
        text_extensions = set(self.config['extraction'].get('code_extensions', []) + 
                             self.config['extraction'].get('doc_extensions', []))
        exclude_patterns = self.config['extraction'].get('exclude_patterns', [])
        
        def should_skip_file(file_path: Path) -> bool:
            """Check if file should be skipped based on patterns."""
            # Convert file path to string for pattern matching
            path_str = str(file_path.relative_to(repo_path))
            
            # Check against exclude patterns
            for pattern in exclude_patterns:
                if '*' in pattern:
                    # Handle wildcard patterns
                    if pattern.startswith('*') and pattern.endswith('*'):
                        if pattern[1:-1] in path_str:
                            return True
                    elif pattern.startswith('*'):
                        if path_str.endswith(pattern[1:]):
                            return True
                    elif pattern.endswith('*'):
                        if path_str.startswith(pattern[:-1]):
                            return True
                else:
                    # Exact match
                    if pattern == path_str:
                        return True
                    # Directory match
                    if pattern.endswith('/') and path_str.startswith(pattern):
                        return True
            
            return False
        
        # Walk through the repository
        for file_path in tqdm(list(repo_path.rglob('*')), desc='Processing files'):
            try:
                # Skip if it's not a file or if it's in .git directory
                if not file_path.is_file() or '.git' in file_path.parts:
                    continue
                    
                # Skip if extension not in our list
                if file_path.suffix.lower() not in text_extensions:
                    continue
                    
                # Skip if matches exclude patterns
                if should_skip_file(file_path):
                    continue
                    
                # Try to read the file content
                try:
                    with file_path.open('r', encoding='utf-8') as f:
                        content = f.read()
                except UnicodeDecodeError:
                    # Skip binary or non-utf8 files
                    continue
                    
                # Create relative path from repo root
                relative_path = str(file_path.relative_to(repo_path))
                
                # Add file content example
                examples.append({
                    'type': 'repository_file',
                    'input': {
                        'file_path': relative_path,
                        'file_type': file_path.suffix.lower()[1:],
                    },
                    'output': content,
                    'metadata': {
                        'file_path': relative_path,
                        'size_bytes': file_path.stat().st_size,
                        'last_modified': file_path.stat().st_mtime
                    }
                })
                
            except Exception as e:
                print(f"Warning: Could not process file {file_path}: {str(e)}")
                continue
                
        return examples

    def save_dataset(self, dataset: List[Dict[str, Any]], output_path: str = 'pretraining_dataset.json'):
        """Save the dataset to a JSON file."""
        output_file = Path(output_path)
        with output_file.open('w', encoding='utf-8') as f:
            json.dump(dataset, f, indent=2)
        print(f"\nDataset saved to {output_file} with {len(dataset)} examples")
        
        # Print statistics
        example_types = {}
        for example in dataset:
            example_types[example['type']] = example_types.get(example['type'], 0) + 1
            
        print("\nDataset statistics:")
        for example_type, count in example_types.items():
            print(f"{example_type}: {count} examples")

def main():
    try:
        creator = PretrainingDatasetCreator()
        dataset = creator.process_repositories()
        creator.save_dataset(dataset)
        
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main() 