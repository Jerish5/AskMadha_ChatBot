import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Book, BookOpen } from 'lucide-react';

const formatBookName = (book) => {
  if (!book) return '';
  const isTamil = /[\u0B80-\u0BFF]/.test(book);
  if (isTamil) return book;
  
  let formatted = book.trim();
  // Insert space after leading numbers (e.g. 1CHRONICLES -> 1 CHRONICLES)
  formatted = formatted.replace(/^([1-3])([A-Za-z])/, '$1 $2');
  
  // Custom mapping for THESONGOFSOLOMON
  if (formatted.toUpperCase() === 'THESONGOFSOLOMON') {
    return 'Song of Solomon';
  }
  
  return formatted
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(' Of ', ' of ');
};

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [languagePreference, setLanguagePreference] = useState('auto');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    // A small timeout ensures the browser has calculated the final heights 
    // of the new DOM elements (like the Biblical References card) before scrolling.
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { text: input, sender: 'user' };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage.text, languagePreference })
      });

      if (!response.ok) {
        let errorMsg = 'Network response was not ok';
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch(e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      
      const botMessage = { 
        text: data.answer, 
        sender: 'bot',
        sources: data.sources 
      };
      
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error fetching chat response:', error);
      const errorMessage = { 
        text: `Sorry, I encountered an error: ${error.message}`, 
        sender: 'bot' 
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const getPlaceholder = () => {
    if (languagePreference === 'english') return "Ask a question about the Bible...";
    if (languagePreference === 'tamil') return "வேதாகமம் பற்றிய கேள்வியை கேளுங்கள் (Ask in Tamil)...";
    return "Ask a question about the Bible in English or Tamil...";
  };

  return (
    <div className="app-container glass glass-panel">
      <header className="header">
        <div className="header-title">
          <BookOpen size={28} color="#a78bfa" />
          <span>Ask Madha</span>
        </div>
        <div className="language-selector">
          <select 
            value={languagePreference} 
            onChange={(e) => setLanguagePreference(e.target.value)}
            className="lang-select"
            disabled={isLoading}
          >
            <option value="auto">Auto-detect Language</option>
            <option value="english">English Only</option>
            <option value="tamil">Tamil Only</option>
          </select>
        </div>
      </header>

      <main className="chat-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <Book size={64} />
            <h2>Welcome to Ask Madha</h2>
            <p>Ask any question about the Bible in English or Tamil.</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className={`message-wrapper ${msg.sender}`}>
              <div className="message-bubble">
                {msg.sender === 'bot' ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
              
              {msg.sources && msg.sources.length > 0 && (
                <div className="sources-container">
                  <div className="sources-title">
                    <Book size={14} /> {msg.text && /[\u0B80-\u0BFF]/.test(msg.text) ? 'ஆதார விவிலிய குறிப்புகள்:' : 'Biblical References'}
                  </div>
                  {msg.sources.map((source, i) => (
                    <div key={i} className="source-item">
                      <span className="source-ref">{formatBookName(source.book)} {source.chapter}:{source.verse}</span>
                      <p className="source-text">{source.text.replace(/^["“']+|["”']+$/g, '')}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        
        {isLoading && (
          <div className="message-wrapper bot">
            <div className="message-bubble">
              <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} style={{ height: '1px', flexShrink: 0 }} />
      </main>

      <div className="input-container">
        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={getPlaceholder()}
            disabled={isLoading}
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || isLoading}>
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
