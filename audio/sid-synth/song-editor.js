// song-editor.js - Song Editor modal functionality
import { patternManager, MAX_PATTERNS } from './pattern-manager.js';

let isEditorOpen = false;
let originalSongData = null;

export function initSongEditor() {
    const modal = document.getElementById('songEditorModal');
    const openButton = document.getElementById('songEditorButton');
    const closeButton = document.getElementById('closeSongEditor');
    
    // Modal control
    openButton.addEventListener('click', openSongEditor);
    closeButton.addEventListener('click', closeSongEditor);
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeSongEditor();
        }
    });
    
    // Button handlers
    document.getElementById('addToSequenceButton').addEventListener('click', addPatternToSequence);
    document.getElementById('removeFromSequenceButton').addEventListener('click', removePatternFromSequence);
    document.getElementById('clearSequenceButton').addEventListener('click', clearSequence);
    document.getElementById('saveSongButton').addEventListener('click', saveSongChanges);
    document.getElementById('cancelSongButton').addEventListener('click', cancelSongChanges);
    
    // Pattern length change handler
    document.getElementById('patternLengthSelect').addEventListener('change', changePatternLength);
    
    // Song title change handler
    document.getElementById('songTitle').addEventListener('input', updateSongTitle);
}

function openSongEditor() {
    const modal = document.getElementById('songEditorModal');
    modal.style.display = 'block';
    isEditorOpen = true;
    
    // Store original song data for cancel functionality
    originalSongData = JSON.parse(JSON.stringify(patternManager.exportSong()));
    
    // Populate the UI with current song data
    populateSongEditor();
    
    console.log('🎼 Song Editor opened');
}

function closeSongEditor() {
    const modal = document.getElementById('songEditorModal');
    modal.style.display = 'none';
    isEditorOpen = false;
}

function populateSongEditor() {
    // Set song title
    document.getElementById('songTitle').value = patternManager.song.title;
    
    // Set current pattern length
    const currentPattern = patternManager.getCurrentPattern();
    document.getElementById('patternLengthSelect').value = currentPattern.length;
    
    // Populate pattern selector for adding
    populateAddPatternSelect();
    
    // Display current sequence
    updateSequenceDisplay();
    
    // Display pattern grid
    updatePatternGrid();
}

function populateAddPatternSelect() {
    const select = document.getElementById('addPatternSelect');
    select.innerHTML = '';
    
    for (let i = 0; i < MAX_PATTERNS; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Pattern ${String.fromCharCode(65 + i)} - ${patternManager.patterns[i].name}`;
        select.appendChild(option);
    }
}

function updateSequenceDisplay() {
    const sequenceList = document.getElementById('sequenceList');
    sequenceList.innerHTML = '';
    
    if (patternManager.song.sequence.length === 0) {
        sequenceList.innerHTML = '<div style="color: #888; text-align: center;">No patterns in sequence</div>';
        return;
    }
    
    patternManager.song.sequence.forEach((patternIndex, position) => {
        const patternDiv = document.createElement('div');
        patternDiv.classList.add('sequence-item');
        patternDiv.dataset.position = position;
        
        const isCurrentPosition = position === patternManager.song.currentPosition;
        
        patternDiv.innerHTML = `
            <span class="sequence-position">${position + 1}:</span>
            <span class="sequence-pattern ${isCurrentPosition ? 'current' : ''}">
                Pattern ${String.fromCharCode(65 + patternIndex)}
            </span>
            <button class="move-up" onclick="moveSequenceItem(${position}, -1)" ${position === 0 ? 'disabled' : ''}>↑</button>
            <button class="move-down" onclick="moveSequenceItem(${position}, 1)" ${position === patternManager.song.sequence.length - 1 ? 'disabled' : ''}>↓</button>
        `;
        
        // Add click handler to select this position
        patternDiv.addEventListener('click', () => selectSequencePosition(position));
        
        sequenceList.appendChild(patternDiv);
    });
}

function updatePatternGrid() {
    const patternGrid = document.getElementById('patternGrid');
    patternGrid.innerHTML = '';
    
    for (let i = 0; i < MAX_PATTERNS; i++) {
        const patternDiv = document.createElement('div');
        patternDiv.classList.add('pattern-grid-item');
        
        const pattern = patternManager.patterns[i];
        const isEmpty = isPatternEmpty(pattern);
        const isCurrent = i === patternManager.currentPatternIndex;
        
        patternDiv.innerHTML = `
            <div class="pattern-letter ${isCurrent ? 'current' : ''}">${String.fromCharCode(65 + i)}</div>
            <div class="pattern-name">${pattern.name}</div>
            <div class="pattern-info">${pattern.length} steps ${isEmpty ? '(empty)' : ''}</div>
        `;
        
        patternDiv.addEventListener('click', () => selectPatternInGrid(i));
        patternDiv.addEventListener('dblclick', () => addPatternToSequenceByIndex(i));
        
        patternGrid.appendChild(patternDiv);
    }
}

function isPatternEmpty(pattern) {
    for (let voice = 0; voice < 3; voice++) {
        for (let step = 0; step < pattern.length; step++) {
            const stepData = pattern.getStepData(voice, step);
            if (stepData.note.trim() !== '') {
                return false;
            }
        }
    }
    return true;
}

function addPatternToSequence() {
    const select = document.getElementById('addPatternSelect');
    const patternIndex = parseInt(select.value);
    
    patternManager.song.addToSequence(patternIndex);
    updateSequenceDisplay();
    
    console.log(`Added Pattern ${String.fromCharCode(65 + patternIndex)} to sequence`);
}

function addPatternToSequenceByIndex(patternIndex) {
    patternManager.song.addToSequence(patternIndex);
    updateSequenceDisplay();
    
    console.log(`Added Pattern ${String.fromCharCode(65 + patternIndex)} to sequence`);
}

function removePatternFromSequence() {
    const selectedItems = document.querySelectorAll('.sequence-item.selected');
    
    if (selectedItems.length === 0) {
        // Remove the last item if nothing selected
        const lastPosition = patternManager.song.sequence.length - 1;
        if (lastPosition >= 0) {
            patternManager.song.removeFromSequence(lastPosition);
            updateSequenceDisplay();
            console.log(`Removed pattern from position ${lastPosition + 1}`);
        }
    } else {
        // Remove selected items (in reverse order to maintain indices)
        const positions = Array.from(selectedItems).map(item => parseInt(item.dataset.position)).sort((a, b) => b - a);
        
        positions.forEach(position => {
            patternManager.song.removeFromSequence(position);
        });
        
        updateSequenceDisplay();
        console.log(`Removed ${positions.length} pattern(s) from sequence`);
    }
}

function clearSequence() {
    if (confirm('Clear the entire song sequence?')) {
        patternManager.song.sequence = [0]; // Reset to just Pattern A
        patternManager.song.currentPosition = 0;
        updateSequenceDisplay();
        console.log('Song sequence cleared');
    }
}

function selectSequencePosition(position) {
    // Remove previous selections
    document.querySelectorAll('.sequence-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Select the clicked item
    const item = document.querySelector(`[data-position="${position}"]`);
    if (item) {
        item.classList.add('selected');
    }
}

function selectPatternInGrid(patternIndex) {
    // Update the add pattern selector
    document.getElementById('addPatternSelect').value = patternIndex;
}

function changePatternLength() {
    const newLength = parseInt(document.getElementById('patternLengthSelect').value);
    const currentPattern = patternManager.getCurrentPattern();
    
    if (confirm(`Change current pattern length from ${currentPattern.length} to ${newLength} steps?`)) {
        currentPattern.length = newLength;
        updatePatternGrid();
        
        // Update the main UI if the pattern is currently being edited
        if (window.refreshTrackerFromPattern) {
            window.refreshTrackerFromPattern();
        }
        
        console.log(`Pattern ${String.fromCharCode(65 + patternManager.currentPatternIndex)} length changed to ${newLength} steps`);
    } else {
        // Reset the selector to current value
        document.getElementById('patternLengthSelect').value = currentPattern.length;
    }
}

function updateSongTitle() {
    const newTitle = document.getElementById('songTitle').value;
    patternManager.song.title = newTitle;
}

function saveSongChanges() {
    console.log('Song changes saved!');
    
    // Update the song position display in main UI
    if (window.updateSongPositionDisplay) {
        window.updateSongPositionDisplay();
    }
    
    closeSongEditor();
}

function cancelSongChanges() {
    if (originalSongData) {
        // Restore original song data
        patternManager.importSong(originalSongData);
        console.log('Song changes cancelled');
    }
    
    closeSongEditor();
}

// Global functions for sequence item controls
window.moveSequenceItem = function(position, direction) {
    const sequence = patternManager.song.sequence;
    const newPosition = position + direction;
    
    if (newPosition >= 0 && newPosition < sequence.length) {
        // Swap the items
        const temp = sequence[position];
        sequence[position] = sequence[newPosition];
        sequence[newPosition] = temp;
        
        // Update current position if it was affected
        if (patternManager.song.currentPosition === position) {
            patternManager.song.currentPosition = newPosition;
        } else if (patternManager.song.currentPosition === newPosition) {
            patternManager.song.currentPosition = position;
        }
        
        updateSequenceDisplay();
    }
};

// Export functions
export { updateSequenceDisplay, updatePatternGrid };