/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI} from '@google/genai';
import {marked} from 'marked';

//gemini-2.5-flash-lite-preview-06-17
//gemini-2.5-flash-preview-04-17
const MODEL_NAME = 'gemini-2.5-flash-preview-04-17';
const POLISHED_NOTE_MODEL_NAME = 'gemini-2.5-flash-lite-preview-06-17';
const RECORDING_SEGMENT_MS = 30 * 1000; // 30 seconds

const USER_CREDENTIALS: UserCredential[] = JSON.parse(process.env.VITE_USER_CREDENTIALS || '[]');

interface UserCredential {
  username: string;
  password: string;
}


interface Note {
  id: string;
  title: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
  polishedLanguage: 'en' | 'zh-TW' | 'ja-JP' | 'ko-KR';
}

class VoiceNotesApp {
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private isRecording = false;
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;
  
  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;
  private segmentIntervalId: number | null = null;
  
  private notes: Note[] = [];
  private currentNoteId: string | null = null;
  private sessionList: HTMLUListElement;

  // Mobile & Language Additions
  private appContainer: HTMLDivElement;
  private sidebarToggleButton: HTMLButtonElement;
  private sidebarOverlay: HTMLDivElement;
  private polishedLanguageSelector: HTMLSelectElement;
  private polishNoteButton: HTMLButtonElement;
  private downloadButton: HTMLButtonElement;

  // Auth elements
  private authOverlay: HTMLDivElement;
  private loginForm: HTMLFormElement;
  private loginError: HTMLParagraphElement;

  // Audio processing queue
  private audioQueue: Blob[] = [];
  private isProcessingQueue = false;

  // Debugging
  private isDebugMode = false;
  private isDebugPanelCollapsed = false;
  private debugPanel: HTMLDivElement | null;
  private debugLogContent: HTMLDivElement | null = null;


  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
    });
    
    // Main UI elements
    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
    this.rawTranscription = document.getElementById('rawTranscription') as HTMLDivElement;
    this.polishedNote = document.getElementById('polishedNote') as HTMLDivElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    
    // Buttons and sidebar
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    
    // Live recording display elements
    this.recordingInterface = document.querySelector('.recording-interface') as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;
    
    // Session history elements
    this.sessionList = document.getElementById('sessionList') as HTMLUListElement;

    // Mobile & Language elements
    this.appContainer = document.querySelector('.app-container') as HTMLDivElement;
    this.sidebarToggleButton = document.getElementById('sidebarToggleButton') as HTMLButtonElement;
    this.sidebarOverlay = document.querySelector('.sidebar-overlay') as HTMLDivElement;
    this.polishedLanguageSelector = document.getElementById('polishedLanguageSelector') as HTMLSelectElement;
    this.polishNoteButton = document.getElementById('polishNoteButton') as HTMLButtonElement;
    this.downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
    
    // Auth elements
    this.authOverlay = document.getElementById('authOverlay') as HTMLDivElement;
    this.loginForm = document.getElementById('loginForm') as HTMLFormElement;
    this.loginError = document.getElementById('loginError') as HTMLParagraphElement;

    // Debugging
    this.debugPanel = document.getElementById('micStatus') as HTMLDivElement;
    this.isDebugMode = new URLSearchParams(window.location.search).get('debug') === 'true';

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    }
    this.statusIndicatorDiv = this.recordingInterface.querySelector('.status-indicator') as HTMLDivElement;
    
    this.initDebugPanel();
    this.bindEventListeners();
    this.initAuth();
    this.initTheme();
    this.loadNotes();
    this.renderSessionList();
    
    this.logDebug('App initialized. Debug logging is active. Note: Request headers are managed by the @google/genai SDK and are not logged here. This log shows the request body passed to the SDK.');

    if (this.notes.length === 0) {
      this.createNewNote();
    } else {
      this.setActiveNote(this.notes[0].id);
    }
    
    this.recordingStatus.textContent = 'Ready to record';
  }
  
  private initDebugPanel(): void {
    if (!this.isDebugMode || !this.debugPanel) return;

    // Create header
    const header = document.createElement('div');
    header.className = 'debug-panel-header';
    header.title = 'Click to toggle collapse';

    const title = document.createElement('span');
    title.textContent = 'Debug Log';
    
    const collapseButton = document.createElement('button');
    collapseButton.id = 'debugCollapseButton';
    collapseButton.innerHTML = `<i class="fas fa-chevron-down"></i>`;

    header.appendChild(title);
    header.appendChild(collapseButton);

    // Create content area
    this.debugLogContent = document.createElement('div');
    this.debugLogContent.className = 'debug-log-content';
    
    // Assemble panel
    this.debugPanel.appendChild(header);
    this.debugPanel.appendChild(this.debugLogContent);
    
    // Add event listener
    header.addEventListener('click', () => this.toggleDebugPanelCollapse());
  }
  
  private toggleDebugPanelCollapse(): void {
    if (!this.isDebugMode || !this.debugPanel) return;
    this.isDebugPanelCollapsed = !this.isDebugPanelCollapsed;
    this.debugPanel.classList.toggle('collapsed', this.isDebugPanelCollapsed);
    document.body.classList.toggle('debug-panel-collapsed', this.isDebugPanelCollapsed);
  }

  private initAuth(): void {
    if (sessionStorage.getItem('isAuthenticated') === 'true') {
      this.authOverlay.classList.add('hidden');
    } else {
      this.authOverlay.classList.remove('hidden');
    }
  }

  private handleLogin(event: Event): void {
    event.preventDefault();
    const formData = new FormData(this.loginForm);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    const isValid = USER_CREDENTIALS.some(
      (cred) => cred.username === username && cred.password === password
    );

    if (isValid) {
      sessionStorage.setItem('isAuthenticated', 'true');
      this.authOverlay.classList.add('hidden');
      this.loginError.textContent = '';
      (this.loginForm.elements.namedItem('password') as HTMLInputElement).value = '';
    } else {
      this.loginError.textContent = 'Invalid username or password.';
      (this.loginForm.elements.namedItem('password') as HTMLInputElement).value = '';
      this.loginForm.classList.add('shake');
      setTimeout(() => this.loginForm.classList.remove('shake'), 500);
    }
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    window.addEventListener('resize', this.handleResize.bind(this));
    this.editorTitle.addEventListener('blur', this.handleTitleChange.bind(this));
    this.sessionList.addEventListener('click', this.handleSessionListClick.bind(this));

    // Listeners for new elements
    this.sidebarToggleButton.addEventListener('click', () => this.toggleSidebar());
    this.sidebarOverlay.addEventListener('click', () => this.toggleSidebar(false));
    this.polishedLanguageSelector.addEventListener('change', () => this.handleLanguageChange());
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    this.polishNoteButton.addEventListener('click', () => this.getPolishedNote());
    this.downloadButton.addEventListener('click', () => this.downloadNote());
  }
  
  private toggleSidebar(force?: boolean): void {
      this.appContainer.classList.toggle('sidebar-open', force);
  }
  
  private async handleLanguageChange(): Promise<void> {
    if (!this.currentNoteId) return;
    const note = this.notes.find(n => n.id === this.currentNoteId);
    if (note) {
      note.polishedLanguage = this.polishedLanguageSelector.value as 'en' | 'zh-TW' | 'ja-JP' | 'ko-KR';
      this.saveNotes();
      // Re-polish the note with the new language if there's text
      if (note.rawTranscription.trim() && note.polishedNote.trim()) {
        await this.getPolishedNote();
      }
    }
  }

  private handleTitleChange(): void {
    if (!this.currentNoteId) return;
    const note = this.notes.find(n => n.id === this.currentNoteId);
    if (note && this.editorTitle.textContent !== note.title) {
        note.title = this.editorTitle.textContent || 'Untitled Note';
        note.timestamp = Date.now();
        this.saveNotes();
        this.renderSessionList();
    }
  }

  private handleSessionListClick(event: MouseEvent): void {
      const target = event.target as HTMLElement;
      const sessionItem = target.closest('.session-item');

      if (!sessionItem) return;
      
      const noteId = sessionItem.getAttribute('data-note-id');
      if (!noteId) return;

      if (target.closest('.delete-note-btn')) {
          this.deleteNote(noteId);
      } else {
          this.setActiveNote(noteId);
          // On mobile, close sidebar after selection
          if (window.innerWidth <= 768) {
              this.toggleSidebar(false);
          }
      }
  }

  private handleResize(): void {
    if (this.isRecording && this.liveWaveformCanvas && this.liveWaveformCanvas.style.display === 'block') {
      requestAnimationFrame(() => this.setupCanvasDimensions());
    }
  }
  
  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.liveWaveformCtx.scale(dpr, dpr);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }
  
  private loadNotes(): void {
    const savedNotes = localStorage.getItem('voice-notes-segmented');
    let notes: Note[] = savedNotes ? JSON.parse(savedNotes) : [];
    
    // Migrate old notes that don't have the language property
    notes.forEach(note => {
      if (!note.polishedLanguage) {
        note.polishedLanguage = 'en';
      }
    });

    this.notes = notes;
    this.notes.sort((a, b) => b.timestamp - a.timestamp);
  }

  private saveNotes(): void {
    this.notes.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem('voice-notes-segmented', JSON.stringify(this.notes));
  }

  private renderSessionList(): void {
    this.sessionList.innerHTML = '';
    this.notes.forEach(note => {
        const li = document.createElement('li');
        li.className = `session-item ${note.id === this.currentNoteId ? 'active' : ''}`;
        li.setAttribute('data-note-id', note.id);

        const titleDiv = document.createElement('div');
        titleDiv.className = 'session-item-title';
        titleDiv.textContent = note.title;

        const dateDiv = document.createElement('div');
        dateDiv.className = 'session-item-date';
        dateDiv.textContent = new Date(note.timestamp).toLocaleDateString();

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-note-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Delete Note';
        
        li.appendChild(titleDiv);
        li.appendChild(dateDiv);
        li.appendChild(deleteBtn);
        this.sessionList.appendChild(li);
    });
  }

  private createNewNote(): void {
    if (this.isRecording) {
      this.stopRecording();
    }

    const newNote: Note = {
      id: `note_${Date.now()}`,
      title: 'Untitled Note',
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
      polishedLanguage: (this.polishedLanguageSelector.value as 'en' | 'zh-TW' | 'ja-JP' | 'ko-KR') || 'en',
    };
    
    this.notes.unshift(newNote);
    this.setActiveNote(newNote.id);
    this.saveNotes();
    this.downloadButton.style.display = 'none';
  }
  
  private deleteNote(noteId: string): void {
      this.notes = this.notes.filter(note => note.id !== noteId);
      this.saveNotes();

      if (this.currentNoteId === noteId) {
          if (this.notes.length > 0) {
              this.setActiveNote(this.notes[0].id);
          } else {
              this.createNewNote();
          }
      }
      this.renderSessionList();
  }

  private setActiveNote(noteId: string | null): void {
      this.currentNoteId = noteId;
      const note = this.notes.find(n => n.id === noteId);

      if (note) {
          this.editorTitle.textContent = note.title;
          this.rawTranscription.textContent = note.rawTranscription;
          this.polishedNote.innerHTML = note.polishedNote;
          this.polishedLanguageSelector.value = note.polishedLanguage || 'en';

          [this.editorTitle, this.rawTranscription, this.polishedNote].forEach(el => {
              const placeholder = el.getAttribute('placeholder') || '';
              if (!el.textContent?.trim() || el.textContent.trim() === placeholder) {
                  el.classList.add('placeholder-active');
                  if (el === this.polishedNote) {
                      el.innerHTML = placeholder;
                  } else {
                      el.textContent = placeholder;
                  }
              } else {
                  el.classList.remove('placeholder-active');
              }
          });

      } else { // Clear view if no note is active
          this.editorTitle.textContent = this.editorTitle.getAttribute('placeholder');
          this.rawTranscription.textContent = this.rawTranscription.getAttribute('placeholder');
          this.polishedNote.innerHTML = this.polishedNote.getAttribute('placeholder') || '';
          [this.editorTitle, this.rawTranscription, this.polishedNote].forEach(el => el.classList.add('placeholder-active'));
      }
      this.renderSessionList();
      this.recordingStatus.textContent = 'Ready to record';
      this.downloadButton.style.display = note?.polishedNote ? 'block' : 'none';
  }

  private async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;
    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);
    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (!this.analyserNode || !this.waveformDataArray || !this.liveWaveformCtx || !this.isRecording) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }
    this.waveformDrawingId = requestAnimationFrame(() => this.drawLiveWaveform());
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);
    
    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);
    if (numBars === 0) return;

    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;
    
    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));
    let x = 0;
    const recordingColor = getComputedStyle(document.documentElement).getPropertyValue('--color-recording').trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;

    for (let i = 0; i < numBars; i++) {
        if (x >= logicalWidth) break;
        const dataIndex = Math.floor(i * (bufferLength / numBars));
        const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
        let barHeight = barHeightNormalized * logicalHeight;
        if (barHeight < 1 && barHeight > 0) barHeight = 1;
        barHeight = Math.round(barHeight);
        const y = Math.round((logicalHeight - barHeight) / 2);
        ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
        x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording) return;
    const elapsedMs = Date.now() - this.recordingStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);
    this.liveRecordingTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas!.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';
    this.setupCanvasDimensions();
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';

    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
    iconElement.classList.replace('fa-microphone', 'fa-stop');

    const currentNote = this.notes.find(n => n.id === this.currentNoteId);
    this.liveRecordingTitle.textContent = currentNote ? currentNote.title : 'New Recording';
    
    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas!.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'block';
    
    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
    iconElement.classList.replace('fa-stop', 'fa-microphone');

    if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.waveformDrawingId = null;
    this.timerIntervalId = null;

    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
        this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }

    if (this.audioContext?.state !== 'closed') {
        this.audioContext?.close().catch(e => console.warn('Error closing audio context', e));
    }
    this.audioContext = null;
    this.analyserNode = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioQueue = [];
      this.isProcessingQueue = false;
      if (this.segmentIntervalId) clearInterval(this.segmentIntervalId);
      this.segmentIntervalId = null;
      
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
      }
      this.audioContext = null;

      if (!this.currentNoteId) {
        this.createNewNote();
      }
      
      this.recordingStatus.textContent = 'Requesting microphone access...';
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.isRecording = true;
      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Stop Recording');
      this.startLiveDisplay();

      this.startNewSegment(); // Starts the first media recorder segment
      
      this.segmentIntervalId = window.setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
        }
      }, RECORDING_SEGMENT_MS);

    } catch (error) {
      console.error('Error starting recording:', error);
      this.recordingStatus.textContent = `Error: ${(error as Error).message}`;
      this.isRecording = false;
      if (this.segmentIntervalId) clearInterval(this.segmentIntervalId);
      this.segmentIntervalId = null;
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.stopLiveDisplay();
    }
  }

  private startNewSegment(): void {
    if (!this.stream || !this.isRecording) {
      console.error("Cannot start new segment, stream or recording state is invalid.");
      if (this.isRecording) {
        // Attempt a graceful stop if this happens unexpectedly
        this.stopRecording();
      }
      return;
    }
    
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4'; // fallback
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''; // use default
    
    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioQueue.push(event.data);
        this.processQueue();
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.isRecording) {
        // This was an automatic segment stop, start the next one.
        this.startNewSegment();
      } else {
        // This was a final, user-initiated stop.
        this.finalCleanup();
      }
    };
    
    this.mediaRecorder.start();
  }
  
  private finalCleanup(): void {
    this.stopLiveDisplay();
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    // Final check on the processing queue
    this.processQueue();
  }

  private async stopRecording(): Promise<void> {
    if (!this.isRecording) return;
    
    this.isRecording = false; // Set this first to affect logic in onstop
    this.recordButton.classList.remove('recording');
    this.recordButton.setAttribute('title', 'Start Recording');
    
    if (this.segmentIntervalId) {
        clearInterval(this.segmentIntervalId);
        this.segmentIntervalId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop(); // Triggers ondataavailable, then onstop
    } else {
      // If recorder is already stopped, ensure cleanup still happens
      this.finalCleanup();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.audioQueue.length === 0) return;

    this.isProcessingQueue = true;

    while (this.audioQueue.length > 0) {
      const queueLength = this.audioQueue.length;
      const statusPrefix = this.isRecording ? 'Processing' : 'Finalizing';
      this.recordingStatus.textContent = `${statusPrefix}... (${queueLength} segment${queueLength > 1 ? 's' : ''} in queue)`;

      const audioBlob = this.audioQueue.shift()!;
      try {
        await this.processAudio(audioBlob);
        if (this.audioQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (err) {
        console.error('Failed to process a segment from the queue after all retries. Stopping.', err);
        this.recordingStatus.textContent = 'Transcription failed. Please try again.';
        this.audioQueue = []; // Clear queue to stop further processing
        if (this.isRecording) {
          await this.stopRecording();
        }
        this.isProcessingQueue = false;
        // After an error, reset to default state after a short delay
        setTimeout(() => { this.recordingStatus.textContent = 'Ready to record'; }, 2000);
        return; // Exit the function entirely on error
      }
    }

    this.isProcessingQueue = false;

    // Final status update after the queue is successfully processed
    if (this.isRecording) {
      this.recordingStatus.textContent = 'Recording...';
    } else {
      const note = this.notes.find(n => n.id === this.currentNoteId);
      if (note && note.rawTranscription.length > 0) {
        this.recordingStatus.textContent = 'Transcription complete. Ready to polish.';
      } else {
        this.recordingStatus.textContent = 'Ready to record';
      }
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) return;

    const reader = new FileReader();
    const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
    });

    if (!base64Audio) throw new Error('Failed to convert audio segment to base64');
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
    await this.appendTranscription(base64Audio, mimeType);
  }

  private async transcribeWithRetry(
    base64Audio: string,
    mimeType: string,
    maxRetries = 3
  ): Promise<string> {
    const audioPart = { inlineData: { mimeType, data: base64Audio } };
    const textPart = { text: 'Transcribe the following audio. The audio may contain English, Traditional Chinese (繁體中文), Japanese (日本語), and Korean (한국어). Provide a faithful and accurate transcript.' };

    const requestBody = {
      model: MODEL_NAME,
      contents: { parts: [textPart, audioPart] },
    };

    let attempt = 0;
    let delay = 1000; // start with 1 second

    while (attempt < maxRetries) {
      attempt++;
      try {
        this.logDebug(`Transcription API call (request body), attempt ${attempt}`, requestBody);

        const response = await this.genAI.models.generateContent(requestBody);
        
        this.logDebug(`Transcription API success, attempt ${attempt}`, response);
        return response.text || ''; // Success
      } catch (error) {
        console.error(`Error on attempt ${attempt} for transcription:`, error);
        this.logDebug(`Transcription API error, attempt ${attempt}`, { 
          message: (error as Error).message, 
          stack: (error as Error).stack,
          errorObject: error 
        });
        
        if (attempt >= maxRetries) {
          this.logDebug(`Transcription failed after ${maxRetries} retries.`);
          throw error;
        }

        const originalStatus = this.recordingStatus.textContent;
        this.recordingStatus.textContent = `Retrying... (${attempt}/${maxRetries})`;

        // Wait with exponential backoff + jitter
        const jitter = Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
        delay *= 2; // Double the delay for the next attempt

        this.recordingStatus.textContent = originalStatus;
      }
    }
    throw new Error('Transcription failed after multiple retries.');
  }

  private async appendTranscription(base64Audio: string, mimeType: string): Promise<void> {
    if (!this.currentNoteId) return;
    try {
      const segmentText = await this.transcribeWithRetry(base64Audio, mimeType);
      const note = this.notes.find(n => n.id === this.currentNoteId);

      if (segmentText && note) {
        note.rawTranscription += (note.rawTranscription ? '\n\n' : '') + segmentText;
        note.timestamp = Date.now();
        this.rawTranscription.textContent = note.rawTranscription;
        this.rawTranscription.classList.remove('placeholder-active');
        this.saveNotes();
        this.renderSessionList(); // Update timestamp display
      } else {
        console.warn('Segment transcription returned no text after retries.');
      }
    } catch (error) {
      console.error('Error getting transcription for segment after all retries:', error);
      throw error;
    }
  }

  private logDebug(message: string, data?: any): void {
    if (!this.isDebugMode || !this.debugPanel || !this.debugLogContent) return;

    const logEntry = document.createElement('pre');
    logEntry.style.whiteSpace = 'pre-wrap';
    logEntry.style.wordBreak = 'break-all';

    const timestamp = new Date().toISOString();
    let content = `${timestamp}: ${message}`;
    
    if (data) {
      try {
        // Clone data to avoid logging the full base64 audio string which is huge
        const dataToLog = JSON.parse(JSON.stringify(data));
        // Check for transcription request body structure and shorten audio data
        if (dataToLog?.contents?.parts?.[1]?.inlineData?.data) {
          const dataString = dataToLog.contents.parts[1].inlineData.data;
          dataToLog.contents.parts[1].inlineData.data = `[...base64 audio data, length: ${dataString.length}, starts with: ${dataString.substring(0, 50)}]`;
        }
        content += `\n${JSON.stringify(dataToLog, null, 2)}`;
      } catch (e) {
        content += `\n[Could not stringify data: ${(e as Error).message}]`;
      }
    }

    logEntry.textContent = content;
    
    const separator = document.createElement('hr');
    separator.style.borderColor = '#444';
    separator.style.margin = '8px 0';
    separator.style.borderStyle = 'solid';
    
    this.debugLogContent.appendChild(logEntry);
    this.debugLogContent.appendChild(separator);
    this.debugLogContent.scrollTop = this.debugLogContent.scrollHeight;
    
    console.log(message, data);

    if (!this.debugPanel.classList.contains('visible')) {
      this.debugPanel.classList.add('visible');
      document.body.classList.add('debug-panel-active');
    }
  }

  private async getPolishedNote(): Promise<void> {
    if (!this.currentNoteId) return;
    const note = this.notes.find(n => n.id === this.currentNoteId);
    if (!note || !note.rawTranscription.trim()) {
        this.recordingStatus.textContent = 'No transcription to polish';
        alert('There is no content to polish yet. Please record something first.');
        return;
    }

    const originalButtonHTML = this.polishNoteButton.innerHTML;
    this.polishNoteButton.disabled = true;
    this.polishNoteButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>Polishing...</span>`;

    try {
      this.recordingStatus.textContent = 'Polishing full note...';
      const lang = note.polishedLanguage || 'en';
      
      const prompts = {
        'en': `Take this raw transcription and create a polished, well-formatted note in English. Remove filler words, repetitions, and false starts. Format lists and bullet points properly using markdown. Maintain all original content and meaning.\n\nRaw transcription:\n${note.rawTranscription}`,
        'zh-TW': `請將以下原始逐字稿，整理成一篇通順、格式良好的繁體中文筆記。移除贅字、重複和無意義的發語詞。適當地使用 Markdown 格式化清單和項目符號。保留所有原始內容和意義。\n\n原始逐字稿:\n${note.rawTranscription}`,
        'ja-JP': `以下の生の文字起こしを、洗練された形式の整った日本語のメモにまとめてください。フィラーワード、繰り返し、言い間違えを削除してください。マークダウンを使用してリストや箇条書きを適切にフォーマットしてください。元の内容と意味はすべて維持してください。\n\n生の文字起こし:\n${note.rawTranscription}`,
        'ko-KR': `다음 원시 녹취록을 세련되고 잘 정리된 한국어 노트로 만들어 주세요。 필러 단어, 반복, 잘못된 시작을 제거해 주세요。 마크다운을 사용하여 목록과 글머리 기호를 올바르게 포맷해 주세요。 모든 원본 내용과 의미를 유지해 주세요。\n\n원시 녹취록:\n${note.rawTranscription}`
      };
      
      const prompt = prompts[lang];

      const response = await this.genAI.models.generateContent({
        model: POLISHED_NOTE_MODEL_NAME,
        contents: prompt,
      });
      const polishedText = response.text || '';

      if (polishedText && note) {
        const htmlContent = await marked.parse(polishedText);
        note.polishedNote = htmlContent;
        this.polishedNote.innerHTML = htmlContent;
        this.polishedNote.classList.remove('placeholder-active');

        // Try to set title from polished note if it's still "Untitled Note"
        if (note.title === 'Untitled Note') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            const h1 = tempDiv.querySelector('h1');
            if (h1 && h1.textContent) {
                note.title = h1.textContent;
                this.editorTitle.textContent = note.title;
            }
        }
        
        note.timestamp = Date.now();
        this.saveNotes();
        this.renderSessionList();
        this.recordingStatus.textContent = this.isRecording ? 'Recording...' : 'Note polished.';
        this.downloadButton.style.display = 'block';
      } else {
        this.recordingStatus.textContent = 'Polishing failed.';
      }
    } catch (error) {
      console.error('Error polishing note:', error);
      this.recordingStatus.textContent = 'Error polishing note.';
    } finally {
      this.polishNoteButton.disabled = false;
      this.polishNoteButton.innerHTML = originalButtonHTML;
    }
  }

  private downloadNote(): void {
    if (!this.currentNoteId) return;
    const note = this.notes.find(n => n.id === this.currentNoteId);
    if (!note) return;

    const polishedContent = note.polishedNote.replace(/<br\s*\/?>/gi, '\n');
    const plainTextPolished = new DOMParser().parseFromString(polishedContent, 'text/html').documentElement.textContent || '';

    const content = `Polished Summary:\n${plainTextPolished}\n\n---\n\nSTT RAW:\n${note.rawTranscription}`;
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/ /g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

  document.querySelectorAll<HTMLElement>('[contenteditable][placeholder]').forEach((el) => {
    const placeholder = el.getAttribute('placeholder')!;

    function updatePlaceholderState() {
      const currentText = (el.id === 'polishedNote' ? el.innerText : el.textContent)?.trim();
      if (!currentText || currentText === placeholder) {
        if (el.id === 'polishedNote') el.innerHTML = placeholder;
        else el.textContent = placeholder;
        el.classList.add('placeholder-active');
      } else {
        el.classList.remove('placeholder-active');
      }
    }
    updatePlaceholderState();
    el.addEventListener('focus', function () {
      if (this.classList.contains('placeholder-active')) {
        if (this.id === 'polishedNote') this.innerHTML = '';
        else this.textContent = '';
        this.classList.remove('placeholder-active');
      }
    });
    el.addEventListener('blur', updatePlaceholderState);
  });
});

export {};