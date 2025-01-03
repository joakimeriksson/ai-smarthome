import sys
import toml
import json
from typing import List, Dict, Any
from pathlib import Path
from tqdm import tqdm
import fitz  # PyMuPDF

class PDFPretrainingDatasetCreator:
    def __init__(self, config_path: str = 'pdf_config.toml'):
        self.config = toml.load(config_path)
        
    def process_pdfs(self) -> List[Dict[str, Any]]:
        """Process all PDF files defined in the config file."""
        dataset = []
        
        for pdf_dir in self.config['pdf_directories']:
            print(f"\nProcessing PDF directory: {pdf_dir['path']}")
            try:
                dir_data = self._process_single_directory(pdf_dir['path'])
                dataset.extend(dir_data)
            except Exception as e:
                print(f"Error processing directory {pdf_dir['path']}: {str(e)}")
                continue
                
        return dataset

    def _process_single_directory(self, dir_path: str) -> List[Dict[str, Any]]:
        """Process a single directory containing PDFs."""
        dir_path = Path(dir_path)
        examples = []
        
        # Process all PDF files in directory and subdirectories
        for pdf_path in tqdm(list(dir_path.rglob("*.pdf")), desc='Processing PDFs'):
            try:
                # Skip if matches exclude patterns
                if self._should_skip_file(pdf_path):
                    continue
                    
                examples.extend(self._process_single_pdf(pdf_path))
                
            except Exception as e:
                print(f"Warning: Could not process PDF {pdf_path}: {str(e)}")
                continue
                
        return examples

    def _should_skip_file(self, file_path: Path) -> bool:
        """Check if file should be skipped based on patterns."""
        exclude_patterns = self.config['extraction'].get('exclude_patterns', [])
        path_str = str(file_path)
        
        for pattern in exclude_patterns:
            if '*' in pattern:
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
                if pattern == path_str:
                    return True
        
        return False

    def _clean_text(self, text: str) -> str:
        """Clean extracted text from PDF while preserving paragraph structure."""
        # Split into paragraphs and clean each one
        paragraphs = []
        
        for paragraph in text.split('\n'):
            # Clean the paragraph
            cleaned_para = paragraph.strip()
            
            # Remove special characters
            for char in ['\x0c', '\t', '\u200b', '\u200c', '\u200d']:
                cleaned_para = cleaned_para.replace(char, '')
            cleaned_para = cleaned_para.replace('\u2217', '*')
            
            # Remove multiple spaces
            cleaned_para = ' '.join(cleaned_para.split())
            
            if cleaned_para:  # Only add non-empty paragraphs
                paragraphs.append(cleaned_para)
        
        # Join paragraphs with double newlines
        return '\n\n'.join(paragraphs)

    def _split_text_into_chunks(self, text: str, min_length: int = 100, max_length: int = 2000) -> List[str]:
        """Split text into reasonable-sized chunks, trying to break at paragraph or sentence boundaries."""
        chunks = []
        
        # First split by paragraphs (double newline)
        paragraphs = text.split('\n\n')
        
        current_chunk = ""
        for paragraph in paragraphs:
            if len(current_chunk) + len(paragraph) <= max_length:
                # Add to current chunk
                if current_chunk:
                    current_chunk += "\n\n"
                current_chunk += paragraph
            else:
                # Current chunk is full
                if len(current_chunk) >= min_length:
                    chunks.append(current_chunk)
                current_chunk = paragraph
        
        # Add the last chunk if it's long enough
        if len(current_chunk) >= min_length:
            chunks.append(current_chunk)
        
        return chunks

    def _process_single_pdf(self, pdf_path: Path) -> List[Dict[str, Any]]:
        """Process a single PDF file and extract text."""
        examples = []
        min_text_length = self.config['dataset'].get('min_text_length', 100)
        max_text_length = self.config['dataset'].get('max_text_length', 2000)
        
        try:
            doc = fitz.open(pdf_path)
            pdf_metadata = self._get_pdf_metadata(pdf_path, doc)
            
            # First pass: collect all page texts to find common prefix
            page_texts = []
            for page in doc:
                text = page.get_text().strip()
                if text:  # Only include non-empty pages
                    page_texts.append(text)
            
            # Find common prefix if we have multiple pages (assuming first page is different)
            common_prefix = ''
            if len(page_texts) > 2:
                # Get first line(s) that are identical across pages
                first_lines = page_texts[1].split('\n')
                second_lines = page_texts[2].split('\n')
                for i, line in enumerate(first_lines):
                    if second_lines[i] == line:
                        common_prefix += line + '\n'
                    else:
                        break
            
            # Second pass: process pages with prefix removed
            for page_num, page in enumerate(doc):
                text = page.get_text().strip()
                if text:
                    # Remove the common prefix if it exists
                    if common_prefix and text.startswith(common_prefix):
                        text = text[len(common_prefix):].strip()
                    
                    # Apply cleaning
                    text = self._clean_text(text)
                    
                    # Split into chunks
                    chunks = self._split_text_into_chunks(
                        text, 
                        min_length=min_text_length,
                        max_length=max_text_length
                    )
                    
                    # Add each chunk as a separate example
                    for chunk_num, chunk in enumerate(chunks):
                        examples.append({
                            'type': 'pdf_text',
                            'input': {
                                'page_number': page_num + 1,
                                'total_pages': len(doc),
                                'chunk_number': chunk_num + 1,
                                'chunk_size' : len(chunk),
                                'total_chunks': len(chunks)
                            },
                            'output': chunk,
                            'metadata': {
                                **pdf_metadata,
                                'page_number': page_num + 1,
                                'chunk_number': chunk_num + 1,
                                'content_type': 'text'
                            }
                        })
            
        finally:
            if 'doc' in locals():
                doc.close()
        
        return examples

    def save_dataset(self, dataset: List[Dict[str, Any]], output_path: str = 'pdf_pretraining_dataset.json'):
        """Save the dataset to a JSON file."""
        output_file = Path(output_path)
        with output_file.open('w', encoding='utf-8') as f:
            json.dump(dataset, f, indent=2)
        print(f"\nDataset saved to {output_file} with {len(dataset)} examples")
        
        # Print statistics
        example_types = {}
        total_text_length = 0
        for example in dataset:
            example_type = example['type']
            example_types[example_type] = example_types.get(example_type, 0) + 1
            if example_type == 'pdf_text':
                total_text_length += len(example['output'])
            
        print("\nDataset statistics:")
        print(f"Total examples: {len(dataset)}")
        for example_type, count in example_types.items():
            print(f"{example_type}: {count} examples")
        print(f"Total text length: {total_text_length:,} characters")
        print(f"Average text length: {total_text_length // len(dataset):,} characters per example")

    def _get_pdf_metadata(self, pdf_path: Path, doc) -> Dict[str, Any]:
        """Extract metadata from PDF file."""
        metadata = {
            'source_file': str(pdf_path),
            'file_name': pdf_path.name,
            'directory': str(pdf_path.parent),
            'size_bytes': pdf_path.stat().st_size,
            'last_modified': pdf_path.stat().st_mtime
        }
        
        # Add PDF document metadata if available
        try:
            doc_metadata = doc.metadata
            if doc_metadata:
                # Common PDF metadata fields
                for key in ['title', 'author', 'subject', 'keywords', 'creator']:
                    if key in doc_metadata and doc_metadata[key]:
                        metadata[f'pdf_{key}'] = doc_metadata[key]
        except:
            pass  # If metadata extraction fails, just use file metadata
        
        return metadata

def main():
    creator = PDFPretrainingDatasetCreator()
    dataset = creator.process_pdfs()
    creator.save_dataset(dataset)
        
if __name__ == '__main__':
    main() 