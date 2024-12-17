import os
import git
import json
import re
import toml
from pathlib import Path
from typing import List, Dict
import markdown
from bs4 import BeautifulSoup
from github import Github

class MultiRepoDatasetGenerator:
    def __init__(self, config_file: str = "config.toml"):
        # Load configuration
        with open(config_file, 'r') as f:
            self.config = toml.load(f)
        
        # Setup GitHub client
        self.gh = Github(self.config['github']['token'])
        
        # Setup paths
        self.output_dir = Path(self.config['dataset']['output_dir'])
        self.output_dir.mkdir(exist_ok=True)
        
        # Load extraction settings
        self.code_extensions = set(self.config['extraction']['code_extensions'])
        self.doc_extensions = set(self.config['extraction']['doc_extensions'])
        self.function_pattern = self.config['extraction']['function_pattern']
        self.min_doc_length = self.config['dataset']['min_doc_length']
        self.min_comment_length = self.config['dataset']['min_comment_length']

    def clone_repository(self, repo_config: Dict) -> git.Repo:
        """Clone or update a repository using configuration."""
        repo_path = Path(repo_config['local_repo_path']).resolve()
        
        if not repo_path.exists():
            print(f"Cloning {repo_config['repo_full_name']}...")
            repo = git.Repo.clone_from(
                f"https://github.com/{repo_config['repo_full_name']}.git",
                repo_path
            )
        else:
            print(f"Using existing repository at {repo_path}")
            repo = git.Repo(repo_path)
            
        # Ensure we're on the correct branch
        if 'local_repo_branch' in repo_config:
            branch = repo_config['local_repo_branch']
            if branch in repo.refs:
                repo.refs[branch].checkout()
            
        return repo

    def extract_documentation(self, repo_path: Path, repo_name: str) -> List[Dict]:
        """Extract documentation from files."""
        docs = []
        
        for doc_ext in self.doc_extensions:
            for doc_file in repo_path.rglob(f"*{doc_ext}"):
                try:
                    with open(doc_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                        
                        # Handle different file types
                        if doc_ext == '.html':
                            soup = BeautifulSoup(content, 'html.parser')
                            text = soup.get_text()
                        elif doc_ext == '.md':
                            html = markdown.markdown(content)
                            soup = BeautifulSoup(html, 'html.parser')
                            text = soup.get_text()
                        else:  # .rst and others
                            text = content
                        
                        # Create instruction-response pairs from documentation
                        sections = text.split('\n\n')
                        for section in sections:
                            section = section.strip()
                            if len(section) > self.min_doc_length:
                                # Create a title from the first line or first few words
                                title = section.split('\n')[0] or ' '.join(section.split()[:5])
                                
                                docs.append({
                                    "instruction": f"Explain this Contiki-NG concept: {title}",
                                    "response": section,
                                    "source": f"{repo_name}: {str(doc_file.relative_to(repo_path))}"
                                })
                except (UnicodeDecodeError, Exception) as e:
                    print(f"Error processing {doc_file}: {str(e)}")
                    continue

        return docs

    def extract_code_examples(self, repo_path: Path, repo_name: str) -> List[Dict]:
        """Extract code examples and their documentation."""
        examples = []
        
        for code_ext in self.code_extensions:
            for file_path in repo_path.rglob(f"*{code_ext}"):
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        
                        # Extract function definitions with comments
                        matches = re.finditer(self.function_pattern, content, re.DOTALL)
                        
                        for match in matches:
                            doc_comment = match.group(1).strip()
                            function_sig = match.group(2).strip()
                            
                            if len(doc_comment) > self.min_comment_length:
                                examples.append({
                                    "instruction": f"Explain the purpose and usage of this function: {function_sig}",
                                    "response": f"This function {doc_comment}\n\nFunction signature: {function_sig}",
                                    "source": f"{repo_name}: {str(file_path.relative_to(repo_path))}"
                                })
                except (UnicodeDecodeError, Exception) as e:
                    print(f"Error processing {file_path}: {str(e)}")
                    continue

        return examples

    def generate_dataset(self):
        """Generate the complete dataset from all repositories."""
        all_docs = []
        
        # Process each repository
        for repo_config in self.config['repositories']:
            print(f"\nProcessing repository: {repo_config['name']}")
            repo = self.clone_repository(repo_config)
            repo_path = Path(repo_config['local_repo_path']).resolve()
            
            print("Extracting documentation...")
            documentation = self.extract_documentation(repo_path, repo_config['name'])
            
            print("Extracting code examples...")
            code_examples = self.extract_code_examples(repo_path, repo_config['name'])
            
            all_docs.extend(documentation)
            all_docs.extend(code_examples)
            
            print(f"Found {len(documentation)} documentation entries and {len(code_examples)} code examples")
        
        # Save complete dataset
        output_file = self.output_dir / "contiki_complete_dataset.jsonl"
        with open(output_file, 'w', encoding='utf-8') as f:
            for item in all_docs:
                f.write(json.dumps(item) + '\n')
        
        print(f"\nGenerated complete dataset with {len(all_docs)} examples")
        print(f"Dataset saved to {output_file}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate dataset from multiple repositories')
    parser.add_argument('--config', default='config.toml', help='Path to config file')
    args = parser.parse_args()
    
    generator = MultiRepoDatasetGenerator(config_file=args.config)
    generator.generate_dataset()
